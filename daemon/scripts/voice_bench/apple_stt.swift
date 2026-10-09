// Feed a WAV to Apple's on-device Turkish dictation at the speed a microphone would,
// and print every result as one JSON line with the audio clock it arrived at.
//
//   swiftc -O apple_stt.swift -o /tmp/divan-voice-bench/apple_stt
//   /tmp/divan-voice-bench/apple_stt fixture.wav [tr_TR] [--fast]
//
// DictationTranscriber (macOS/iOS 26) is the Speech framework's on-device path that
// covers Turkish; the newer SpeechTranscriber does not list tr_TR at all. It is the
// closest thing to the phone's recogniser that runs here without a microphone
// permission prompt: the app's own SFSpeechRecognizer server path needs that
// authorisation, which a command-line process cannot get unattended.
//
// Output lines: {"t_ms": arrival on the audio clock, "final": bool, "text": "...",
// "audio_end_ms": end of the audio the result covers}. A last line {"done_ms": ...}.

import AVFoundation
import Foundation
import Speech

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: apple_stt file.wav [locale] [--fast]"); exit(2) }
let path = args[1]
let localeId = args.count >= 3 && !args[2].hasPrefix("--") ? args[2] : "tr_TR"
let fast = args.contains("--fast")

func emit(_ obj: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: obj)
  print(String(data: data, encoding: .utf8)!)
  fflush(stdout)
}

let done = DispatchSemaphore(value: 0)
Task {
  do {
    let transcriber = DictationTranscriber(
      locale: Locale(identifier: localeId), contentHints: [],
      transcriptionOptions: [.punctuation], reportingOptions: [.volatileResults],
      attributeOptions: [.audioTimeRange])
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      try await req.downloadAndInstall()
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let want = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) ?? file.processingFormat
    try await analyzer.prepareToAnalyze(in: want)
    let (stream, feed) = AsyncStream<AnalyzerInput>.makeStream()
    let clock = ContinuousClock()
    var started = clock.now
    let ms: () -> Int = { Int((clock.now - started).components.attoseconds / 1_000_000_000_000_000)
                           + Int((clock.now - started).components.seconds) * 1000 }

    let reader = Task {
      for try await r in transcriber.results {
        var end = -1
        let range = r.text.runs.compactMap { $0.audioTimeRange }.last
        if let range { end = Int(range.end.seconds * 1000) }
        emit(["t_ms": ms(), "final": r.isFinal, "text": String(r.text.characters), "audio_end_ms": end])
      }
    }
    try await analyzer.start(inputSequence: stream)

    // 100 ms buffers, each released when the audio clock reaches it.
    let chunk = AVAudioFrameCount(file.processingFormat.sampleRate / 10)
    let converter = AVAudioConverter(from: file.processingFormat, to: want)!
    started = clock.now
    var fed = 0
    while file.framePosition < file.length {
      let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk)!
      try file.read(into: buf, frameCount: chunk)
      let outCap = AVAudioFrameCount(Double(buf.frameLength) * want.sampleRate / file.processingFormat.sampleRate) + 32
      let out = AVAudioPCMBuffer(pcmFormat: want, frameCapacity: outCap)!
      var given = false
      var err: NSError?
      converter.convert(to: out, error: &err) { _, status in
        if given { status.pointee = .noDataNow; return nil }
        given = true; status.pointee = .haveData; return buf
      }
      feed.yield(AnalyzerInput(buffer: out))
      fed += Int(buf.frameLength)
      if !fast {
        let due = started + .milliseconds(fed * 1000 / Int(file.processingFormat.sampleRate))
        try await Task.sleep(until: due, clock: .continuous)
      }
    }
    feed.finish()
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    try await reader.value
    emit(["done_ms": ms()])
  } catch {
    emit(["error": "\(error)"])
  }
  done.signal()
}
done.wait()
