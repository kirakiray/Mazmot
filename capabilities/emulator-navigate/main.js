export default function emulatorNavigate({ data = {}, content, emulator }) {
  const { action } = data;

  if (action === "current-info") {
    return {
      url: emulator.url,
    };
  }
}
