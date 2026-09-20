import { RecorderActivityChannel } from '../activity';

it('stays busy across queued operations and publishes activity before work can await', () => {
  const channel = new RecorderActivityChannel();
  const changes = jest.fn();
  channel.subscribe(changes);
  const first = channel.begin();
  const second = channel.begin();
  channel.setState('arming');
  first();
  expect(changes.mock.calls.map(([state]) => state)).toEqual([
    { state: 'idle', lifecycleBusy: false },
    { state: 'idle', lifecycleBusy: true },
    { state: 'arming', lifecycleBusy: true },
  ]);
  channel.setState('recording');
  second();
  second();
  expect(changes).toHaveBeenLastCalledWith({ state: 'recording', lifecycleBusy: false });
  expect(changes).toHaveBeenCalledTimes(5);
});

it('isolates observer failures and stops notifying an unsubscribed observer', () => {
  const channel = new RecorderActivityChannel();
  channel.subscribe(() => { throw new Error('download failed'); });
  const observer = jest.fn();
  const unsubscribe = channel.subscribe(observer);
  expect(() => { const finish = channel.begin(); channel.setState('recording'); finish(); }).not.toThrow();
  unsubscribe();
  channel.setState('completed');
  expect(observer).toHaveBeenLastCalledWith({ state: 'recording', lifecycleBusy: false });
});
