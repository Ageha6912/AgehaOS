import { Desktop } from '@/desktop/Desktop'
import { BootScreen } from '@/desktop/boot/BootScreen'
import { useBootStore } from '@/store/boot-store'

export default function App() {
  const phase = useBootStore((state) => state.phase)

  return <div className="h-full">{phase === 'ready' ? <Desktop /> : <BootScreen />}</div>
}
