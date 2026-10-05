import { After } from './screens/After';
import { Buy } from './screens/Buy';
import { Connect } from './screens/Connect';
import { Counter } from './screens/Counter';
import { Destination } from './screens/Destination';
import { Home } from './screens/Home';
import { MoveScreen } from './screens/Move';
import { Review } from './screens/Review';
import { TopUp } from './screens/TopUp';
import { WalletCreate, WalletVerify } from './screens/Wallet';
import { useRoute } from './router';
import { useApp } from './state';

export function App() {
  const route = useRoute();
  const { owner } = useApp();
  const [a, b] = route;

  // Pages that work without a connected wallet.
  if (a === 'counter') return <Counter />;
  if (a === 'move' && b) return <MoveScreen id={b} />;
  if (a === 'after' && b) return <After id={b} />;
  if (!owner) return <Connect />;

  switch (a) {
    case 'destination':
      return <Destination />;
    case 'wallet':
      return b === 'check' ? <WalletVerify /> : <WalletCreate />;
    case 'topup':
      return <TopUp />;
    case 'buy':
      return <Buy />;
    case 'review':
      return <Review />;
    default:
      return <Home />;
  }
}
