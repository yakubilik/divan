import ExpoModulesCore

/// Being rung by your own computer.
///
/// This module is only the part iOS insists on owning: the system call screen
/// (CallKit) and the push that can wake a terminated app to show it (PushKit).
/// Speech in and out is not here — it is `src/voice.ts`, on top of the phone's
/// own recognition and synthesis, and it works whether the call was placed from
/// this phone or arrived at it.
///
/// One rule shapes the whole file: iOS terminates an app that accepts a VoIP
/// push without reporting a call, and repeating that stops delivery to the app
/// altogether. So the push handler reports a call every time, before anything
/// else — see `CallCenter.pushRegistry(_:didReceiveIncomingPushWith:)`.
public class RacCallModule: Module {
  private var center: CallCenter?

  public func definition() -> ModuleDefinition {
    Name("RacCall")

    Events("onVoipToken", "onCallRinging", "onCallAnswered", "onCallEnded",
           "onCallFailed", "onCallMuted", "onAudioReady", "onAudioGone")

    OnCreate {
      let emit: (String, [String: Any]) -> Void = { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
      let center = CallCenter(emit: emit)
      self.center = center
      // Registering here, rather than when a call starts, is the point: the
      // token has to exist on the Mac long before the first call.
      center.registerForPush()
    }

    OnDestroy {
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
  }
}
