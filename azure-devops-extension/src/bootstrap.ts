import * as SDK from "azure-devops-extension-sdk";

declare global {
  interface Window {
    __C4143_EXTENSION__?: {
      org: string;
      orgName: string;
      project: string;
      token: string;
    };
  }
}

async function start(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  const context = SDK.getWebContext();
  const host = SDK.getHost();
  const token = await SDK.getAccessToken();
  const project = context.project?.name;
  if (!project) throw new Error("Open this extension from an Azure DevOps project.");

  window.__C4143_EXTENSION__ = {
    org: `https://dev.azure.com/${encodeURIComponent(host.name)}`,
    orgName: host.name,
    project,
    token
  };

  document.getElementById("extension-loading")?.remove();
  const script = document.createElement("script");
  script.src = "C4143-DV-SIT-Dashboard.user.js";
  script.onload = () => SDK.notifyLoadSucceeded();
  script.onerror = () => SDK.notifyLoadFailed("Unable to load the packaged dashboard core.");
  document.body.appendChild(script);
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const loading = document.getElementById("extension-loading");
  if (loading) loading.textContent = `C4143 Dashboard failed to start: ${message}`;
  SDK.notifyLoadFailed(message);
});
