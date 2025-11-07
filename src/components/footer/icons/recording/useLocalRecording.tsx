import { useState } from 'react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { Track } from 'livekit-client';
import { DataMsgBodyType } from 'plugnmeet-protocol-js';

import {
  IUseLocalRecordingReturn,
  RecordingEvent,
  RecordingType,
} from './IRecording';
import { store } from '../../../../store';
import { getMediaServerConnRoom } from '../../../../helpers/livekit/utils';
import { getNatsConn } from '../../../../helpers/nats';

const useLocalRecording = (): IUseLocalRecordingReturn => {
  const currentRoom = getMediaServerConnRoom();
  const conn = getNatsConn();

  const [recordingEvent, setRecordingEvent] = useState<RecordingEvent>(
    RecordingEvent.NONE,
  );
  const [hasError, setHasError] = useState<boolean>(false);
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  const TYPE_OF_RECORDING = RecordingType.RECORDING_TYPE_LOCAL;
  let recordingData: Array<Blob> = [];
  const displayMediaOptions = {
    preferCurrentTab: true,
    video: true,
    audio: true,
  };
  const session = store.getState().session;
  const { t } = useTranslation();

  const startRecording = async () => {
    if (captureStream) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      setCaptureStream(stream);
      startRecorder(stream);
    } catch (e) {
      const err = `Error: ${e}`;
      toast(err, { toastId: 'recording-status', type: 'error' });
      setHasError(true);
      setCaptureStream(null);
    }
  };

  const stopRecording = () => {
    if (recorder) {
      recorder.stop();
    }
    if (captureStream) {
      captureStream.getTracks().forEach((track) => track.stop());
      setCaptureStream(null);
    }
  };

  const startRecorder = async (captureStream: MediaStream) => {
    const date = new Date();
    const fileName = `${conn.roomId}_${date.toLocaleString()}`;
  
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
  
    // Kết nối âm thanh từ hệ thống
    if (captureStream.getAudioTracks().length) {
      try {
        const displayAudioSource = ctx.createMediaStreamSource(captureStream);
        displayAudioSource.connect(dest);
      } catch (error) {
        console.error("Lỗi kết nối âm thanh hệ thống:", error);
      }
    }
  
    // Xử lý micro của người dùng
    const localTrack = currentRoom.localParticipant.getTrackPublication(
      Track.Source.Microphone
    );
    let micAudioSource: MediaStreamAudioSourceNode | null = null;
  
    // Hàm kết nối micro
    const connectMicAudio = () => {
      if (
        !localTrack ||
        localTrack.isMuted ||
        !localTrack.audioTrack ||
        !localTrack.audioTrack.mediaStream
      )
        return;
      
      try {
        micAudioSource = ctx.createMediaStreamSource(localTrack.audioTrack.mediaStream);
        micAudioSource.connect(dest);
        console.log("Đã kết nối micro");
      } catch (error) {
        console.error("Lỗi kết nối micro:", error);
      }
    };
  
    // Hàm ngắt kết nối micro
    const disconnectMicAudio = () => {
      if (!micAudioSource) return;
      
      try {
        micAudioSource.disconnect(dest);
        micAudioSource = null;
        console.log("Đã ngắt kết nối micro");
      } catch (error) {
        console.error("Lỗi ngắt kết nối micro:", error);
      }
    };
  
    // Lắng nghe sự kiện từ publication
    if (localTrack) {
      // Kết nối ban đầu nếu micro đang bật
      if (!localTrack.isMuted) connectMicAudio();
  
      // Xử lý sự kiện mute/unmute
      localTrack.on("muted", disconnectMicAudio);
      localTrack.on("unmuted", connectMicAudio);
    }
  
    // Xử lý âm thanh từ người tham gia khác
    currentRoom.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (
          publication.kind === Track.Kind.Audio &&
          publication.audioTrack &&
          publication.audioTrack.mediaStream
        ) {
          try {
            const remoteSource = ctx.createMediaStreamSource(
              publication.audioTrack.mediaStream
            );
            remoteSource.connect(dest);
          } catch (error) {
            console.error("Lỗi kết nối âm thanh từ người khác:", error);
          }
        }
      });
    });
    
    // Kết hợp video track từ captureStream và audio đã trộn từ dest
    const videoTrack = captureStream.getVideoTracks()[0];
    const mixedAudioTracks = dest.stream.getTracks();
    const combinedTracks = [videoTrack, ...mixedAudioTracks];
    const combinedStream = new MediaStream(combinedTracks);

    // Chọn MIME type phù hợp cho video (ví dụ: MP4 với H.264 và AAC)
    const supportedMimeType = 'video/mp4;codecs="avc1.42E01E, mp4a.40.2"';
    const mimeType = MediaRecorder.isTypeSupported(supportedMimeType)
      ? supportedMimeType
      : 'video/mp4';

    const recorder = new MediaRecorder(combinedStream, { mimeType });

    recorder.onstart = () => {
      setRecordingEvent(RecordingEvent.STARTED_RECORDING);
      setHasError(false);
      broadcastNotification(true);
    };

    recorder.ondataavailable = (e) => {
      recordingData.push(e.data);
    };

    recorder.onstop = () => {
      setRecordingEvent(RecordingEvent.STOPPED_RECORDING);
      setHasError(false);

      const blobData = new Blob(recordingData, { type: mimeType });
      const url = URL.createObjectURL(blobData);
      const a: HTMLAnchorElement = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);

      // Dừng captureStream
      if (captureStream) {
        captureStream.getTracks().forEach((track) => track.stop());
        setCaptureStream(null);
      }

      setRecorder(null);
      recordingData = [];
      broadcastNotification(false);
    };

    recorder.onerror = () => {
      setHasError(true);
      if (captureStream) {
        captureStream.getTracks().forEach((track) => track.stop());
        setCaptureStream(null);
      }
      setRecorder(null);
      recordingData = [];
    };

    recorder.start();
    setRecorder(recorder);
  };

  const broadcastNotification = async (start = true) => {
    let msg = t('notifications.local-recording-ended', {
      name: session.currentUser?.name,
    });
    if (start) {
      msg = t('notifications.local-recording-started', {
        name: session.currentUser?.name,
      });
    }
    conn.sendDataMessage(DataMsgBodyType.INFO, msg);
  };

  const resetError = () => {
    if (hasError) {
      setHasError(false);
    }
  };

  return {
    TYPE_OF_RECORDING,
    recordingEvent,
    hasError,
    startRecording,
    stopRecording,
    resetError,
  };
};

export default useLocalRecording;
