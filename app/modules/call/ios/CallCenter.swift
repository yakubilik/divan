import AVFAudio
import CallKit
import PushKit

/// The call itself: the VoIP push that wakes the phone, the system's incoming
/// call screen, and the audio session underneath it.
///
/// One rule shapes this whole file. Since iOS 13 every VoIP push **must** report
/// an incoming call to CallKit inside the same callback; a push that does not is
/// a terminated app, and doing it repeatedly stops iOS delivering VoIP pushes to
/// this app at all. So `didReceiveIncomingPushWith` reports a call on every path
/// out of it, including the malformed-payload one — there is no branch here that
/// returns without reporting.
final class CallCenter: NSObject {
  typealias Emit = (_ event: String, _ payload: [String: Any]) -> Void

  private let emit: Emit
  private let provider: CXProvider
  private let controller = CXCallController()
  private var registry: PKPushRegistry?
  /// The call on screen, if any, and what it is about. `chatId` is how JS knows
  /// which conversation the person just answered.
  private(set) var callId: UUID?
  private(set) var chatId: String?

  init(emit: @escaping Emit) {
    self.emit = emit
    // The no-argument initialiser takes the name from the bundle, so the call
    // screen says whatever the app is actually called on this phone.
    let config = CXProviderConfiguration()
    config.supportsVideo = false
    config.maximumCallsPerCallGroup = 1
    config.maximumCallGroups = 1
    // The agent is not a person in an address book, and a phone number here
    // would be a lie the system then tries to look up.
    config.supportedHandleTypes = [.generic]
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  /// Ask iOS for a VoIP push token. Called as early as the module exists rather
  /// than when a screen asks, because the push that matters is the one that
  /// arrives while this app is not running.
  func registerForPush() {
    guard registry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
  }

  /// Put a call on screen without a push — the path a local network takes when
  /// the phone and the Mac are already talking and no push is needed.
  func reportIncoming(chatId: String, from: String, completion: ((Error?) -> Void)? = nil) {
    let id = UUID()
    self.callId = id
    self.chatId = chatId
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: from)
    update.localizedCallerName = from
    update.hasVideo = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsHolding = false
    update.supportsDTMF = false
    provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
      if let error {
        self?.callId = nil
        self?.chatId = nil
        self?.emit("onCallFailed", ["reason": error.localizedDescription])
      } else {
        self?.emit("onCallRinging", ["chatId": chatId, "from": from])
      }
      completion?(error)
    }
  }

  /// Hang up from this side — the agent finished, or JS decided the call is over.
  func end() {
    guard let id = callId else { return }
    let action = CXEndCallAction(call: id)
    controller.request(CXTransaction(action: action)) { [weak self] error in
      if error != nil {
        // The transaction failed, but the call must not be left on screen.
        self?.provider.reportCall(with: id, endedAt: nil, reason: .remoteEnded)
      }
    }
  }

  /// The call is connected as far as the system is concerned: the timer starts
  /// and the UI stops saying "connecting".
  func reportConnected() {
    guard let id = callId else { return }
    provider.reportOutgoingCall(with: id, connectedAt: nil)
  }

  private func clear() {
    callId = nil
    chatId = nil
  }
}

// MARK: - the system's call screen

extension CallCenter: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    clear()
    emit("onCallEnded", ["reason": "reset"])
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    // The audio session is configured here and *activated by the system*, which
    // is why nothing below turns it on: doing that here is the classic way to
    // get a call with no sound.
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
    } catch {
      emit("onCallFailed", ["reason": "audio session: \(error.localizedDescription)"])
    }
    emit("onCallAnswered", ["chatId": chatId ?? ""])
    action.fulfill()
  }

  // MARK: - a call the person starts

  /// The other direction: the app is already in front, so there is nothing to
  /// ring and nothing to answer. CallKit's incoming-call screen would be wrong
  /// here — it exists to interrupt, and this is not an interruption. What is
  /// still needed is the audio session, which the system activates for an
  /// answered call but nobody activates for this one.
  func startLocal(chatId: String) {
    self.chatId = chatId
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
      try session.setActive(true, options: [])
    } catch {
      emit("onCallFailed", ["reason": "audio session: \(error.localizedDescription)"])
      return
    }
    emit("onCallAnswered", ["chatId": chatId])
    emit("onAudioReady", [:])
  }

  func endLocal() {
    let chat = chatId ?? ""
    clear()
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    emit("onAudioGone", [:])
    emit("onCallEnded", ["reason": "ended", "chatId": chat])
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let chat = chatId ?? ""
    clear()
    emit("onCallEnded", ["reason": "ended", "chatId": chat])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    emit("onCallMuted", ["muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    emit("onAudioReady", [:])
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    emit("onAudioGone", [:])
  }
}

// MARK: - the push that wakes the phone

extension CallCenter: PKPushRegistryDelegate {
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    // This is not the token expo-notifications hands out. It is a second,
    // separate token for a separate APNs topic (`<bundle-id>.voip`), and the
    // Mac has to store both.
    emit("onVoipToken", ["token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    emit("onVoipToken", ["token": ""])
  }

  func pushRegistry(_ registry: PKPushRegistry,
                    didReceiveIncomingPushWith payload: PKPushPayload,
                    for type: PKPushType,
                    completion: @escaping () -> Void) {
    // Every path below reports a call. See the note at the top of this file.
    let data = payload.dictionaryPayload
    let chatId = (data["chat_id"] as? String) ?? ""
    let from = (data["from"] as? String) ?? "Agent"
    reportIncoming(chatId: chatId, from: from) { _ in completion() }
  }
}
