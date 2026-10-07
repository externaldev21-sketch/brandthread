import React from "react";
// Device-only boundary. Tests that grant permission override this explicitly.
export const CameraView = React.forwardRef((props: any, ref: any) =>
  React.createElement("CameraView", { ...props, ref }));
const permission = { status: "undetermined", granted: false, canAskAgain: true, expires: "never" };
export function useCameraPermissions() {
  return [permission, async () => permission, async () => permission] as const;
}
export async function requestCameraPermissionsAsync() { return permission; }
export async function getCameraPermissionsAsync() { return permission; }
