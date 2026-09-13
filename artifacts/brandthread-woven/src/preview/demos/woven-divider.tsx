import { WovenDivider } from '../../components/woven-divider';
import { Guidelines, Stack } from '../parts';

export function WovenDividerDemo() {
  return <Stack label="Variants">
    <WovenDivider />
    <WovenDivider variant="section" label="New collection" />
    <WovenDivider variant="quiet" />
    <Guidelines items={[
      { kind: 'do', text: 'Use stitches to separate meaningful sections and list groups.' },
      { kind: 'dont', text: 'Do not add stitches around every control or create visual noise.' },
    ]} />
  </Stack>;
}