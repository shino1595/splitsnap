import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';

/** Current time, refreshed every minute and whenever the screen gains focus (for '5 min ago'). */
export function useNow(): Date {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useFocusEffect(
    React.useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  return React.useMemo(() => new Date(), [tick]);
}
