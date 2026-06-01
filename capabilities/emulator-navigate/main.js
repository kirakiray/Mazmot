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
    await emulator.reload();
    return {
      success: true,
      url: emulator.url,
    };
  }

  if (action === "go") {
    await emulator.go(url);
    return {
      success: true,
      url: url,
    };
  }
}
