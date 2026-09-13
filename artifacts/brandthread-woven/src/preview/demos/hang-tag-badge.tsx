import { HangTagBadge } from '../../components/hang-tag-badge';
import { Row } from '../parts';

export function HangTagBadgeDemo() {
  return <Row label="Commerce states">
    <HangTagBadge variant="live">Live drop</HangTagBadge>
    <HangTagBadge variant="drop">New drop</HangTagBadge>
    <HangTagBadge variant="sale">Archive sale</HangTagBadge>
    <HangTagBadge variant="status">Draft</HangTagBadge>
  </Row>;
}