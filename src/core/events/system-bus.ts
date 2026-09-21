import { EventBus } from './event-bus'
import type { SystemEventMap } from './types'

export const systemBus = new EventBus<SystemEventMap>()
