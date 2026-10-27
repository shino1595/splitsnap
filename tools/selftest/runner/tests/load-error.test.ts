// Self-test: DELIBERATE load failure. Importing a .tsx module is not possible in unit tests.
import { Widget } from '../app/src/ui/Widget';

it('never runs', () => {
  expect(Widget).toBeDefined();
});
