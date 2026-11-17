import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { StateHub } from './StateHub';

const StateHubContext = createContext<StateHub | null>(null);

export function StateHubProvider({
  hub,
  children,
}: {
  hub: StateHub;
  children: ReactNode;
}) {
  return (
    <StateHubContext.Provider value={hub}>
      {children}
    </StateHubContext.Provider>
  );
}

export function useHub(): StateHub {
  const hub = useContext(StateHubContext);
  if (!hub) throw new Error('useHub must be used inside <StateHubProvider>');
  return hub;
}