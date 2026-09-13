import { StitchedAvatar } from '../../components/stitched-avatar';
import { Row } from '../parts';

export function StitchedAvatarDemo() {
  return <Row label="Sizes and presence">
    <StitchedAvatar alt="Avery Chen" initials="AC" size={32} />
    <StitchedAvatar alt="Maya Studio" initials="MS" size={40} status="online" />
    <StitchedAvatar alt="Northline Live" initials="NL" size={56} status="live" />
    <StitchedAvatar alt="Brandthread seller" initials="BT" size={72} />
  </Row>;
}