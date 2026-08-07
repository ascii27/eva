import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { FaceScreen } from './src/face/FaceScreen';

export default function App() {
  // The device is a permanently-powered desk appliance; the face never sleeps.
  useKeepAwake();
  return (
    <>
      <StatusBar hidden />
      <FaceScreen />
    </>
  );
}
