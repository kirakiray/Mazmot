export default async function emulatorConsole({ data = {}, emulator }) {
  const { action } = data;

  if (action === "get") {
    try {
      const logs = await sendMessage(emulator.iframe, { type: "get-console" });
      return {
        success: true,
        logs,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  if (action === "clear") {
    try {
      await sendMessage(emulator.iframe, { type: "clear-console" });
      return {
        success: true,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

function sendMessage(iframe, message) {
  return new Promise((resolve, reject) => {
    if (!iframe || !iframe.contentWindow) {
      reject(new Error("Iframe not available"));
      return;
    }

    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      reject(new Error("Message timeout"));
    }, 5000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result);
      }
    };

    iframe.contentWindow.postMessage(message, "*", [channel.port2]);
  });
}
