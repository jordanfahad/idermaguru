(function () {
  var script = document.currentScript;
  if (!script) return;

  var tenant = script.getAttribute("data-tenant") || "ai-derma-guru";
  var origin = new URL(script.src).origin;
  var frameUrl = origin + "/embed?tenant=" + encodeURIComponent(tenant);

  var root = document.createElement("div");
  root.setAttribute("data-ai-derma-guru-widget", "true");
  root.style.position = "fixed";
  root.style.right = "20px";
  root.style.bottom = "20px";
  root.style.zIndex = "2147483647";
  root.style.fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "AI Derma Guru";
  button.style.border = "0";
  button.style.borderRadius = "999px";
  button.style.background = "#171315";
  button.style.color = "#fff";
  button.style.boxShadow = "0 18px 50px rgba(23, 19, 21, 0.28)";
  button.style.cursor = "pointer";
  button.style.fontWeight = "800";
  button.style.minHeight = "54px";
  button.style.padding = "0 18px";

  var panel = document.createElement("div");
  panel.style.display = "none";
  panel.style.width = "min(460px, calc(100vw - 28px))";
  panel.style.height = "min(780px, calc(100vh - 98px))";
  panel.style.marginBottom = "12px";
  panel.style.border = "1px solid #dce6e1";
  panel.style.borderRadius = "10px";
  panel.style.overflow = "hidden";
  panel.style.background = "#fff";
  panel.style.boxShadow = "0 24px 80px rgba(23, 19, 21, 0.22)";

  var frame = document.createElement("iframe");
  frame.title = "AI Derma Guru skincare advisor";
  frame.src = frameUrl;
  frame.allow = "camera; microphone";
  frame.style.border = "0";
  frame.style.width = "100%";
  frame.style.height = "100%";

  panel.appendChild(frame);
  root.appendChild(panel);
  root.appendChild(button);
  document.body.appendChild(root);

  button.addEventListener("click", function () {
    var open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    button.textContent = open ? "AI Derma Guru" : "Close advisor";
  });
})();
