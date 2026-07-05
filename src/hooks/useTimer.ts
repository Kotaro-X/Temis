import { useEffect, useState } from "react";

export const useTimer = () => {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return {
    activeTaskId,
    setActiveTaskId,
    now,
  };
};
