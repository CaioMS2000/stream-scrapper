import _dayjs from 'dayjs'
import 'dayjs/locale/pt-br'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { TIMEZONE } from './constants'

_dayjs.extend(utc)
_dayjs.extend(timezone)
_dayjs.extend(localizedFormat)
_dayjs.locale('pt-br')
_dayjs.tz.setDefault(TIMEZONE)

const dayjs = _dayjs.tz

export { dayjs }
