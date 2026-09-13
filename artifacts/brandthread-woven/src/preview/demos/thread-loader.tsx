import { ThreadLoader } from '../../components/thread-loader';
import { Row, Stack } from '../parts';

export function ThreadLoaderDemo() {
  return <Stack label="Threading states">
    <ThreadLoader label="Preparing your drop" />
    <Row label="Inline"><ThreadLoader compact /></Row>
  </Stack>;
}