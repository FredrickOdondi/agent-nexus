import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { accountFromSession } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { Section } from "../SettingsDialog";

export function AccountTab() {
  const session = useAuth().session;
  const signOut = useStore((s) => s.signOut);
  const account = accountFromSession(session);

  return (
    <div>
      <Section title="Google account" description="This account is how Nimbus knows the phone and the computer belong to you. Chats stay on this computer.">
        {account ? (
          <div className="flex items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3">
            {account.avatar ? (
              <img src={account.avatar} alt="" className="size-12 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{account.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-base font-medium">{account.name}</span>
              {account.email && <span className="block truncate text-sm text-muted-foreground">{account.email}</span>}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Google account is signed in on this device.</p>
        )}
        <Button variant="outline" className="h-11 w-full text-base lg:h-9 lg:w-auto lg:text-sm" onClick={() => void signOut()}>
          <LogOut />Sign out
        </Button>
      </Section>
    </div>
  );
}
