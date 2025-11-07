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
    if (captureStream) return;
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

    // Tạo AudioContext và đảm bảo nó được kích hoạt
    const ctx = new AudioContext();
    await ctx.resume(); // Đảm bảo AudioContext luôn chạy
    const dest = ctx.createMediaStreamDestination();

    // 1. Thêm audio từ captureStream (có thể bao gồm âm thanh từ hệ thống)
    if (captureStream.getAudioTracks().length) {
      try {
        const displayAudioSource = ctx.createMediaStreamSource(captureStream);
        displayAudioSource.connect(dest);
      } catch (error) {
        console.error("Error connecting display audio:", error);
      }
    }

    // 2. Thêm audio từ microphone của chính bạn qua getUserMedia
    let selfAudioStream: MediaStream | undefined;
    try {
      selfAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (selfAudioStream.getAudioTracks().length === 0) {
        console.error("Không tìm thấy audio tracks trong selfAudioStream");
      } else {
        const selfAudioSource = ctx.createMediaStreamSource(selfAudioStream);
        selfAudioSource.connect(dest);
        console.log("Self microphone audio đã được kết nối");
      }
    } catch (err) {
      console.error("Error capturing self microphone audio:", err);
    }

    // 3. (Tùy chọn) Thêm audio từ local track của hệ thống họp nếu có
    const localTrack = currentRoom.localParticipant.getTrackPublicationByName(
      Track.Source.Microphone,
    );
    if (localTrack?.audioTrack?.mediaStream) {
      try {
        const localAudioSource = ctx.createMediaStreamSource(localTrack.audioTrack.mediaStream);
        localAudioSource.connect(dest);
      } catch (error) {
        console.error("Error connecting local participant audio:", error);
      }
    }

    // 4. Thêm audio từ các remote participants (người khác tham gia)
    currentRoom.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.audioTrack && publication.audioTrack.mediaStream) {
          try {
            const remoteAudioSource = ctx.createMediaStreamSource(publication.audioTrack.mediaStream);
            remoteAudioSource.connect(dest);
          } catch (error) {
            console.error("Error connecting remote participant audio:", error);
          }
        }
      });
    });

    // 5. Kết hợp video track từ captureStream và audio đã trộn từ dest
    const videoTrack = captureStream.getVideoTracks()[0];
    const mixedAudioTracks = dest.stream.getTracks();
    const combinedTracks = [videoTrack, ...mixedAudioTracks];
    const combinedStream = new MediaStream(combinedTracks);

    // 6. Xác định MIME type cho MP4 với video H.264 và audio AAC
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

      // Dừng captureStream và self microphone stream
      if (captureStream) {
        captureStream.getTracks().forEach((track) => track.stop());
        setCaptureStream(null);
      }
      if (selfAudioStream) {
        selfAudioStream.getTracks().forEach((track) => track.stop());
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
