import { useState } from 'react';
import { apiLogin } from '@/api/authApi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** Shown when a page needs data and nobody is signed in. Uses the same /auth/login as the builder. */
export function LoginScreen({ onLoggedIn, notice, pageSlug }: { onLoggedIn: () => void; notice?: string; pageSlug?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiLogin(email.trim(), password, pageSlug);
      onLoggedIn();
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div>
          <h1 className="text-lg font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground">{notice ?? 'Sign in to view this page.'}</p>
        </div>
        <Input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
    </div>
  );
}