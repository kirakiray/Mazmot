export default async function emulatorNavigate({
  data = {},
  content,
  emulator,
}) {
  const { action, url } = data;

  if (action === "current-info") {
    return {
      url: emulator.url,
    };
  }

  if (action === "reload") {
    try {
      await emulator.reload();
      return {
        success: true,
        url: emulator.url,
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
      await emulator.go(url);
      return {
        success: true,
        url,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}
