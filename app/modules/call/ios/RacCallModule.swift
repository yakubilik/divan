import ExpoModulesCore

/// Being rung by your own computer.
///
/// This module is only the part iOS insists on owning: the system call screen
/// (CallKit) and the push that can wake a terminated app to show it (PushKit).
/// It also carries the streaming call's audio engine (`VoiceEngine.swift`): the
/// echo-cancelled microphone and the player the reply goes through. What is said
/// and when is `src/voice-session.ts`, and it works whether the call was placed
/// from this phone or arrived at it.
///
/// One rule shapes the whole file: iOS terminates an app that accepts a VoIP
/// push without reporting a call, and repeating that stops delivery to the app
/// altogether. So the push handler reports a call every time, before anything
/// else — see `CallCenter.pushRegistry(_:didReceiveIncomingPushWith:)`.
public class RacCallModule: Module {
  private var center: CallCenter?
  private var voice: VoiceEngine?

  public func definition() -> ModuleDefinition {
    Name("RacCall")

    Events("onVoipToken", "onCallRinging", "onCallAnswered", "onCallEnded",
           "onCallFailed", "onCallMuted", "onAudioReady", "onAudioGone",
           "onMicFrame", "onPlayback", "onAudioRoute", "onAudioInterruption", "onAudioFailed")

    OnCreate {
      let emit: (String, [String: Any]) -> Void = { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
      let center = CallCenter(emit: emit)
      self.center = center
      self.voice = VoiceEngine(emit: emit)
      // Registering here, rather than when a call starts, is the point: the
      // token has to exist on the Mac long before the first call.
      center.registerForPush()
    }

    OnDestroy {
      self.voice?.stop()
      self.voice = nil
      self.center = nil
    }

    /// Ring this phone locally. Only useful for trying the call screen without
    /// a push; the real path comes from APNs.
    AsyncFunction("reportIncoming") { (chatId: String, from: String) in
      self.center?.reportIncoming(chatId: chatId, from: from)
    }

    /// A call the person places from inside the app: no ring and no answer
    /// step, just the audio session the conversation needs.
    AsyncFunction("startVoiceSession") { (chatId: String) in
      self.center?.startLocal(chatId: chatId)
    }

    AsyncFunction("endVoiceSession") {
      self.center?.endLocal()
    }

    AsyncFunction("endCall") {
      self.center?.end()
    }

    AsyncFunction("reportConnected") {
      self.center?.reportConnected()
    }

    // The streaming call's audio (VoiceEngine.swift): echo-cancelled microphone in, one player out.

    /// `callKit` when the session belongs to a call CallKit answered.
    AsyncFunction("voiceStart") { (callKit: Bool) in
      guard let voice = self.voice else { throw VoiceError.notLoaded }
      try voice.start(callKit: callKit || self.center?.callId != nil)
    }.runOnQueue(.main)

    AsyncFunction("voiceStop") {
      self.voice?.stop()
    }.runOnQueue(.main)

    Function("voiceRunning") { () -> Bool in
      self.voice?.isRunning ?? false
    }

    Function("voicePlay") { (id: String, pcm: String, rate: Double) in
      guard let data = Data(base64Encoded: pcm) else { return }
      self.voice?.play(id: id, pcm: data, rate: rate)
    }

    Function("voiceFlush") {
      self.voice?.flush()
    }

    AsyncFunction("voiceSynthesize") { (text: String, language: String, voice: String?, rate: Double, promise: Promise) in
      guard let engine = self.voice else { promise.reject(VoiceError.notLoaded); return }
      engine.synthesize(text: text, language: language, voice: voice, rate: Float(rate)) { pcm, sampleRate in
        promise.resolve(["pcm": pcm.base64EncodedString(), "rate": sampleRate])
      }
    }.runOnQueue(.main)
  }
}

enum VoiceError: Error, CustomStringConvertible {
  case notLoaded
  var description: String { "the voice engine is not loaded" }
}
