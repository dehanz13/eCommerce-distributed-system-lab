import { Lab } from '../../components/lab';
/** Render the route’s lab view from framework routing; no owner state is accessed directly.
 * Input: no arguments; uses its current owner state, from framework route/layout content.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export default function Page() {
  return <Lab view="system" />;
}
