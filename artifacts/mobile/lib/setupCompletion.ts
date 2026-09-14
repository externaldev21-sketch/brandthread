import {
  completeTask,
  type SetupTaskId,
} from '@/lib/setupStore';

export async function completeSetupTaskWhen(
  id: SetupTaskId,
  confirmed: boolean,
): Promise<boolean> {
  if (!confirmed) return false;
  await completeTask(id);
  return true;
}

export async function completeSetupTaskAfter<T>(
  id: SetupTaskId,
  action: () => Promise<T>,
  confirmsSuccess: (result: T) => boolean = () => true,
): Promise<T> {
  const result = await action();
  await completeSetupTaskWhen(id, confirmsSuccess(result));
  return result;
}