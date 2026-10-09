import AVFAudio
import Foundation

/// The audio of a streaming call: the microphone in and the reply out, on one `AVAudioEngine` with voice
/// processing switched on.
///
/// One engine for both directions is the point. Voice processing is Apple's echo canceller, and it can only
/// take out what it knows is being played — so the reply goes through a player node on this same engine
/// rather than through another player, and the microphone that reaches JS is already echo-cancelled. That
/// is what lets the call listen while it talks (`src/voice-session.ts` does the rest: barge-in, turn ids).
///
/// Microphone audio leaves as 16 kHz mono PCM16 in 50 ms frames (`onMicFrame`), the format the daemon
/// takes. Playback arrives as PCM16 items of any rate; each reports `started` when it reaches the speaker
/// and `done` when it has been played, and `flush()` silences everything at once.
///
/// No Expo in here: `RacCallModule` hands it a function to send events with, so the file can be checked
/// on its own with `swiftc -typecheck`.
final class VoiceEngine {
  typealias Emit = (_ event: String, _ payload: [String: Any]) -> Void

  private let emit: Emit
  private let queue = DispatchQueue(label: "rac.voice.engine")
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var converter: AVAudioConverter?
  private var observers: [NSObjectProtocol] = []
  private let micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private let playFormat = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
  private var pending: [Int16] = []
  private let frameSamples = 800                        // 50 ms at 16 kHz
  /// Bumped by every flush and stop, so a completion of a buffer from before it is ignored.
  private var generation = 0
  /// Items on the player, in order; the head is the one playing.
  private var items: [String] = []
  private var ownsSession = false
  private(set) var isRunning = false

  init(emit: @escaping Emit) {
    self.emit = emit
  }

  deinit { teardown(deactivate: true) }

  private static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

  // MARK: - starting and stopping

  /// Put the call's session in place and start the engine. `callKit` when the system activated the
  /// session for an answered call: then it is not ours to activate or to switch off.
  func start(callKit: Bool) throws {
    if isRunning { return }
    let session = AVAudioSession.sharedInstance()
    guard session.recordPermission == .granted else {
      throw NSError(domain: "RacVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "mic_denied"])
    }
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
    try? session.setPreferredSampleRate(48000)
    try? session.setPreferredIOBufferDuration(0.01)
    if !callKit {
      try session.setActive(true, options: [])
      ownsSession = true
    }
    try build()
    observe()
  }

  private func build() throws {
    let engine = AVAudioEngine()
    let input = engine.inputNode
    // The echo canceller. It also turns on Apple's noise suppression and automatic gain on the input.
    try input.setVoiceProcessingEnabled(true)
    if #available(iOS 17.0, *) {
      // Voice processing ducks every other sound the app plays; the reply is on this engine, so nothing
      // else needs ducking and the reply must not be turned down.
      input.voiceProcessingOtherAudioDuckingConfiguration =
        AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
    }
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playFormat)
    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, let converter = AVAudioConverter(from: inFormat, to: micFormat) else {
      throw NSError(domain: "RacVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "no microphone input"])
    }
    self.converter = converter
    input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(inFormat.sampleRate / 50), format: inFormat) { [weak self] buffer, _ in
      self?.capture(buffer)
    }
    engine.prepare()
    try engine.start()
    player.play()
    self.engine = engine
    self.player = player
    queue.sync {
      self.pending.removeAll()
      self.items.removeAll()
      self.generation += 1
    }
    isRunning = true
  }

  /// Let go of the microphone and the player. The session is switched off only if this engine switched
  /// it on (a call started in the app); CallKit's own session is CallKit's to end.
  func stop() {
    teardown(deactivate: ownsSession)
  }

  private func teardown(deactivate: Bool) {
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
    stopEngine()
    if deactivate {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
      ownsSession = false
    }
  }

  private func stopEngine() {
    queue.sync {
      self.generation += 1
      self.items.removeAll()
      self.pending.removeAll()
    }
    player?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    player = nil
    converter = nil
    isRunning = false
  }

  // MARK: - microphone

  private func capture(_ buffer: AVAudioPCMBuffer) {
    guard let converter else { return }
    let ratio = micFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, let ch = out.int16ChannelData, out.frameLength > 0 else { return }
    let samples = Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    let now = Self.nowMs()
    var frames: [[Int16]] = []
    queue.sync {
      self.pending.append(contentsOf: samples)
      while self.pending.count >= self.frameSamples {
        frames.append(Array(self.pending[0..<self.frameSamples]))
        self.pending.removeFirst(self.frameSamples)
      }
    }
    // Each frame is stamped with when its first sample was heard.
    for (i, f) in frames.enumerated() {
      let data = f.withUnsafeBufferPointer { Data(buffer: $0) }
      let age = Double(frames.count - i) * 50.0
      emit("onMicFrame", ["pcm": data.base64EncodedString(), "t_ms": now - age])
    }
  }

  // MARK: - playback

  /// Queue PCM16 mono at `rate` as item `id`.
  func play(id: String, pcm: Data, rate: Double) {
    guard let player, isRunning else { return }
    let count = pcm.count / 2
    guard count > 0,
          let src = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true),
          let inBuf = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: AVAudioFrameCount(count)) else { return }
    inBuf.frameLength = AVAudioFrameCount(count)
    pcm.withUnsafeBytes { raw in
      if let base = raw.baseAddress { memcpy(inBuf.int16ChannelData![0], base, count * 2) }
    }
    guard let conv = AVAudioConverter(from: src, to: playFormat) else { return }
    let outCap = AVAudioFrameCount(Double(count) * playFormat.sampleRate / rate) + 64
    guard let outBuf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: outCap) else { return }
    var fed = false
    var error: NSError?
    conv.convert(to: outBuf, error: &error) { _, status in
      if fed { status.pointee = .endOfStream; return nil }
      fed = true
      status.pointee = .haveData
      return inBuf
    }
    guard error == nil else { return }
    var startNow = false
    var gen = 0
    queue.sync {
      gen = self.generation
      startNow = self.items.isEmpty
      self.items.append(id)
    }
    if startNow { emit("onPlayback", ["id": id, "state": "started", "t_ms": audibleAt()]) }
    player.scheduleBuffer(outBuf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.finished(id: id, generation: gen)
    }
  }

  /// When what is handed to the player now is heard: now plus the route's output latency.
  private func audibleAt() -> Double {
    Self.nowMs() + AVAudioSession.sharedInstance().outputLatency * 1000
  }

  private func finished(id: String, generation gen: Int) {
    var next: String?
    var current = false
    queue.sync {
      guard gen == self.generation, self.items.first == id else { return }
      current = true
      self.items.removeFirst()
      next = self.items.first
    }
    guard current else { return }
    emit("onPlayback", ["id": id, "state": "done", "t_ms": Self.nowMs()])
    if let next { emit("onPlayback", ["id": next, "state": "started", "t_ms": audibleAt()]) }
  }

  /// Silence now and drop everything queued. The player is ready for the next item straight after.
  func flush() {
    queue.sync {
      self.generation += 1
      self.items.removeAll()
    }
    player?.stop()
    if isRunning { player?.play() }
  }

  // MARK: - the system voice, through this engine

  private var synth: AVSpeechSynthesizer?

  /// The system voice's audio for `text`, as PCM16 mono, for `play`. Synthesised rather than spoken, so a
  /// call that has to use it still goes through the echo canceller and still reports what was heard.
  func synthesize(text: String, language: String, voice: String?, rate: Float,
                  done: @escaping (_ pcm: Data, _ rate: Double) -> Void) {
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice.flatMap { AVSpeechSynthesisVoice(identifier: $0) } ?? AVSpeechSynthesisVoice(language: language)
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * rate
    let synth = AVSpeechSynthesizer()
    self.synth = synth
    var out = Data()
    var sampleRate = 22050.0
    var finished = false
    synth.write(utterance) { buffer in
      guard !finished else { return }
      guard let pcm = buffer as? AVAudioPCMBuffer else { return }
      if pcm.frameLength == 0 {
        finished = true
        done(out, sampleRate)
        return
      }
      sampleRate = pcm.format.sampleRate
      let n = Int(pcm.frameLength)
      if let i16 = pcm.int16ChannelData {
        out.append(Data(bytes: i16[0], count: n * 2))
      } else if let f32 = pcm.floatChannelData {
        var s = [Int16](repeating: 0, count: n)
        for k in 0..<n { s[k] = Int16(max(-1, min(1, f32[0][k])) * 32767) }
        s.withUnsafeBufferPointer { out.append(Data(buffer: $0)) }
      }
    }
  }

  // MARK: - the world changing under the call

  private func observe() {
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
      guard let self else { return }
      let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
      let output = session.currentRoute.outputs.first?.portName ?? ""
      let name: String
      switch reason {
      case .newDeviceAvailable: name = "newDeviceAvailable"
      case .oldDeviceUnavailable: name = "oldDeviceUnavailable"
      case .override: name = "override"
      case .categoryChange: name = "categoryChange"
      default: name = "other"
      }
      self.emit("onAudioRoute", ["reason": name, "output": output])
    })
    // A new route can change the hardware format; the engine stops itself and has to be built again.
    if let engine {
      observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
        self?.rebuild(reason: "configuration change")
      })
    }
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
      let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) ?? 0
      let began = AVAudioSession.InterruptionType(rawValue: raw) == .began
      self?.emit("onAudioInterruption", ["began": began])
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { [weak self] _ in
      self?.emit("onAudioFailed", ["reason": "media services were reset"])
    })
  }

  private func rebuild(reason: String) {
    guard isRunning else { return }
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
    stopEngine()
    do {
      try build()
      observe()
      // The old player went with the old engine, items and all, without a completion: say so.
      emit("onAudioRoute", ["reason": "rebuilt", "flushed": true,
                            "output": AVAudioSession.sharedInstance().currentRoute.outputs.first?.portName ?? ""])
    } catch {
      emit("onAudioFailed", ["reason": "\(reason): \(error.localizedDescription)"])
    }
  }
}
