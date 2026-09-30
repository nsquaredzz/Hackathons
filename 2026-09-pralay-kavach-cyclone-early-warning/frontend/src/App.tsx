import Citizen from './Citizen'
import Console from './Console'

export default function App() {
  return location.pathname.startsWith('/citizen') ? <Citizen /> : <Console />
}
