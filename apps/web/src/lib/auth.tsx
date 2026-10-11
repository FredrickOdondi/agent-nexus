import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
  ready: boolean;
  session: Session | null;
}

const AuthContext = createContext<AuthState>({ ready: false, session: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, session: null });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ ready: true, session });
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        const hash = sessionStorage.getItem("nimbus.returnHash");
        if (hash && !location.hash) {
          sessionStorage.removeItem("nimbus.returnHash");
          location.hash = hash;
        }
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
