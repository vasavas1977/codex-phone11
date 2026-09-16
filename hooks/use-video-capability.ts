import { useEffect, useState } from "react";
import { getVideoBridge } from "@/lib/sip/video-runtime";
export function useVideoCapability() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void getVideoBridge().then((bridge) => {
      if (alive) setAvailable(!!bridge);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
