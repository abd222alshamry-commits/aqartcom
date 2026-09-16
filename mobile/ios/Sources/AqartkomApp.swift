import SwiftUI
import WebKit

@main
struct AqartkomApp: App {
    var body: some Scene { WindowGroup { BrowserScreen().ignoresSafeArea() } }
}
struct BrowserScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> BrowserController { BrowserController() }
    func updateUIViewController(_ controller: BrowserController, context: Context) {}
}
final class BrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let web: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "AqartkomNative/92"
        return WKWebView(frame: .zero, configuration: configuration)
    }()
    private let status = UILabel()
    private var site: URL?
    private func trusted(_ url: URL) -> Bool {
        guard let site = site else { return false }
        return url.scheme == "https" && url.host?.lowercased() == site.host?.lowercased()
            && (url.port ?? 443) == (site.port ?? 443)
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let toolbar = UIToolbar()
        toolbar.items = [
            UIBarButtonItem(title: "رجوع", style: .plain, target: self, action: #selector(back)),
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(title: "الرئيسية", style: .plain, target: self, action: #selector(home)),
            UIBarButtonItem(title: "تحديث", style: .plain, target: self, action: #selector(reload)),
            UIBarButtonItem(title: "مشاركة", style: .plain, target: self, action: #selector(share))
        ]
        status.textAlignment = .center; status.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [toolbar, status, web]); stack.axis = .vertical
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 44)
        ])
        web.navigationDelegate = self; web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "AqartkomURL") as? String,
              let url = URL(string: raw), url.scheme == "https", let host = url.host,
              !host.hasSuffix(".invalid"), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else {
            status.text = "يجب إعداد رابط المنصة HTTPS في المشروع قبل البناء."; return
        }
        site = url; home()
    }
    @objc private func back() { if web.canGoBack { web.goBack() } }
    @objc private func home() { if let site = site { web.load(URLRequest(url: site)) } }
    @objc private func reload() { if web.url == nil { home() } else { web.reload() } }
    @objc private func share() {
        guard let url = web.url, trusted(url) else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: 60, width: 1, height: 1)
        present(sheet, animated: true)
    }
    private func external(_ url: URL) {
        guard ["https", "tel", "mailto"].contains(url.scheme ?? "") else { return }
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            if !opened { self?.status.text = "لا يوجد تطبيق لفتح هذا الرابط." }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if trusted(url) { decisionHandler(.allow) }
        else {
            if action.navigationType == .linkActivated && (action.targetFrame == nil || action.targetFrame?.isMainFrame == true) { external(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, trusted(url) { webView.load(action.request) }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { status.text = "جارٍ التحميل…" }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status.text = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { status.text = "تعذر الاتصال. تحقق من الإنترنت واضغط تحديث." }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { status.text = "تعذر التحميل. اضغط تحديث للمحاولة." }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { status.text = "توقفت الصفحة. اضغط تحديث." }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "عقارتكم", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "عقارتكم", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "تأكيد", style: .default) { _ in completionHandler(true) }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "عقارتكم", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completionHandler(alert.textFields?.first?.text) }); present(alert, animated: true)
    }
}
