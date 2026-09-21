import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'

export function Desktop() {
  return (
    <div className="relative h-full overflow-hidden bg-gradient-to-b from-[#231437] via-[#151033] to-[#0b0d14]">
      <WindowLayer />
      <Taskbar />
    </div>
  )
}
