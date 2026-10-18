// Divan in the share sheet (#333): the link out of what was shared, handed to
// the app as `divan://share?url=…` (or `?text=…` when it came as words with a
// link inside them — Instagram and X send it that way). Nothing is drawn: the
// app opens, and what to do with the link is decided there (src/share.ts).
//
// Copied into ios/DivanShare/ by plugins/with-share-extension.js on prebuild.
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  private var started = false

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if started { return }
    started = true
    shared { [weak self] url, text in
      guard let self else { return }
      if let link = Self.link(url: url, text: text) { _ = self.open(link) }
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  /// The first web URL among the attachments, and the first text, read in parallel.
  private func shared(_ done: @escaping (URL?, String?) -> Void) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    let group = DispatchGroup()
    let lock = NSLock()
    var url: URL?
    var text: String?
    for p in providers {
      if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
          let u = (item as? URL) ?? (item as? NSURL).map { $0 as URL } ?? (item as? String).flatMap(URL.init(string:))
          lock.lock(); if url == nil, let u, u.scheme == "http" || u.scheme == "https" { url = u }; lock.unlock()
          group.leave()
        }
      } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
          let t = (item as? String) ?? (item as? NSAttributedString)?.string
          lock.lock(); if text == nil { text = t }; lock.unlock()
          group.leave()
        }
      }
    }
    group.notify(queue: .main) { done(url, text) }
  }

  /// `divan://share?url=…` for a URL, `?text=…` for words; the app finds the link in them.
  static func link(url: URL?, text: String?) -> URL? {
    let (key, value): (String, String)
    if let url { (key, value) = ("url", url.absoluteString) }
    else if let text, !text.isEmpty { (key, value) = ("text", text) }
    else { (key, value) = ("text", "") }
    // Everything but the unreserved characters is escaped, `&`, `=`, `+` and `#` included.
    let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    guard let v = value.addingPercentEncoding(withAllowedCharacters: unreserved) else { return nil }
    return URL(string: "divan" + "://" + "share" + "?\(key)=\(v)")
  }

  /// An extension cannot reach `UIApplication.shared`; the app object is found
  /// up the responder chain instead, which is the way a share extension opens
  /// its own app.
  private func open(_ url: URL) -> Bool {
    var r: UIResponder? = self
    while let cur = r {
      if let app = cur as? UIApplication {
        app.open(url, options: [:], completionHandler: nil)
        return true
      }
      r = cur.next
    }
    return false
  }
}
