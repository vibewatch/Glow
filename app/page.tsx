import { GlowDashboard } from "@/components/glow-dashboard";
import { LocaleProvider } from "@/components/locale-context";

export default function Home() {
  return (
    <LocaleProvider>
      <GlowDashboard />
    </LocaleProvider>
  );
}
