export default async function emulatorNavigate({
  data = {},
  content,
  emulator,
}) {
  const { action, url } = data;

  if (action === "current-info") {
    const iframe = emulator.iframe;
    return {
      url: iframe?.src || "",
    };
  }

  if (action === "reload") {
    try {
      const iframe = emulator.iframe;
      if (!iframe) {
        return { success: false, error: "No iframe available" };
      }
      emulator.iframeLoaded = false;
      const loadPromise = listenIframeLoad(iframe);
      iframe.src = iframe.src;
      await loadPromise;
      return {
        success: true,
        url: iframe.src,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  if (action === "go") {
    try {
      if (!url) {
        return { success: false, error: "No URL provided" };
      }
      emulator.iframeLoaded = false;

      let iframe = emulator.iframe;
      let loadPromise;

      if (iframe) {
        // iframe 已存在，先注册监听器再更新 URL
        loadPromise = listenIframeLoad(iframe);
        emulator.iframeUrl = url;
      } else {
        // iframe 不存在，先设置 URL 触发创建，再等待并监听
        emulator.iframeUrl = url;
        iframe = await pollIframe(emulator);
        loadPromise = listenIframeLoad(iframe);
      }

      await loadPromise;
      return {
        success: true,
        url: iframe.src,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

function listenIframeLoad(iframe, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Iframe load timeout"));
    }, timeout);
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Iframe load failed"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
    };
    iframe.addEventListener("load", onLoad);
    iframe.addEventListener("error", onError);
  });
}

function pollIframe(emulator, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const iframe = emulator.iframe;
    if (iframe) {
      resolve(iframe);
      return;
    }
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Iframe not available"));
    }, timeout);
    const interval = setInterval(() => {
      const iframe = emulator.iframe;
      if (iframe) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(iframe);
      }
    }, 50);
  });
}
