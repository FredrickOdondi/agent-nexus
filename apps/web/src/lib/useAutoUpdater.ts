import { useEffect, useState } from "react";
import { bridge, isElectron, type UpdateStatus } from "@/lib/platform";

export function useAutoUpdater() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isElectron || !bridge?.updater) return;
    const cleanup = bridge.updater.onStatus((newStatus) => {
      setStatus(newStatus);
      if (newStatus.state !== "checking") {
        setChecking(false);
      }
    });
    return cleanup;
  }, []);

  const checkForUpdates = async () => {
    if (!isElectron || !bridge?.updater) return null;
    setChecking(true);
    try {
      const res = await bridge.updater.checkForUpdates();
      setStatus(res);
      return res;
    } catch (e) {
      const errStatus: UpdateStatus = { state: "error", message: (e as Error).message };
      setStatus(errStatus);
      return errStatus;
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!isElectron || !bridge?.updater) return false;
    return bridge.updater.installUpdate();
  };

  return {
    status,
    checking,
    checkForUpdates,
    installUpdate,
    hasUpdateDownloaded: status?.state === "downloaded",
    isDownloading: status?.state === "downloading",
  };
}
