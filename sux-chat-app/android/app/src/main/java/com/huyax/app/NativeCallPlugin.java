package com.huyax.app;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

/**
 * Медиа-слой звонков на нативном WebRTC (зеркало iOS-плагина).
 *
 * В WebView разговор жил только пока приложение открыто: система усыпляет
 * веб-процесс, и звук пропадал при блокировке экрана. Нативный движок вместе
 * с фоновым сервисом переживает и блокировку, и сворачивание.
 *
 * Сигналинг остаётся в вебе: сюда приходят SDP и ICE, обратно уходят события.
 * Соединения хранятся по участнику, поэтому групповой звонок работает тем же
 * кодом.
 */
@CapacitorPlugin(name = "NativeCall")
public class NativeCallPlugin extends Plugin {

    private PeerConnectionFactory factory;
    private AudioTrack audioTrack;
    private AudioSource audioSource;
    private final Map<String, PeerConnection> peers = new HashMap<>();
    private List<PeerConnection.IceServer> iceServers = new ArrayList<>();
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    @PluginMethod
    public void start(PluginCall call) {
        ensureFactory();
        iceServers = parseIceServers(call.getArray("iceServers"));

        if (audioTrack == null) {
            MediaConstraints constraints = new MediaConstraints();
            audioSource = factory.createAudioSource(constraints);
            audioTrack = factory.createAudioTrack("hyax-audio", audioSource);
            audioTrack.setEnabled(true);
        }

        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            // Нативный движок пишет и играет через голосовой тракт, поэтому
            // режим связи здесь уместен: он же включает эхоподавление.
            previousAudioMode = am.getMode();
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(true);
        }
        CallForegroundService.start(getContext());
        call.resolve();
    }

    @PluginMethod
    public void createPeer(PluginCall call) {
        String peerId = call.getString("peerId");
        if (peerId == null) {
            call.reject("peerId обязателен");
            return;
        }
        peer(peerId);
        call.resolve();
    }

    @PluginMethod
    public void createOffer(final PluginCall call) {
        final String peerId = call.getString("peerId");
        if (peerId == null) {
            call.reject("peerId обязателен");
            return;
        }
        final PeerConnection pc = peer(peerId);
        pc.createOffer(new SimpleSdpObserver() {
            @Override
            public void onCreateSuccess(final SessionDescription sdp) {
                pc.setLocalDescription(new SimpleSdpObserver() {
                    @Override
                    public void onSetSuccess() {
                        emitSdp(peerId, "offer", sdp.description);
                        call.resolve();
                    }
                }, sdp);
            }

            @Override
            public void onCreateFailure(String error) {
                call.reject(error);
            }
        }, offerConstraints());
    }

    @PluginMethod
    public void setRemoteDescription(final PluginCall call) {
        final String peerId = call.getString("peerId");
        final String type = call.getString("type");
        final String sdp = call.getString("sdp");
        if (peerId == null || type == null || sdp == null) {
            call.reject("нужны peerId, type и sdp");
            return;
        }
        final PeerConnection pc = peer(peerId);
        SessionDescription.Type sdpType =
            "offer".equals(type) ? SessionDescription.Type.OFFER : SessionDescription.Type.ANSWER;

        pc.setRemoteDescription(new SimpleSdpObserver() {
            @Override
            public void onSetSuccess() {
                if (!"offer".equals(type)) {
                    call.resolve();
                    return;
                }
                // На входящий offer отвечаем сразу: лишний круг через JS
                // только задержал бы первый звук.
                pc.createAnswer(new SimpleSdpObserver() {
                    @Override
                    public void onCreateSuccess(final SessionDescription answer) {
                        pc.setLocalDescription(new SimpleSdpObserver() {
                            @Override
                            public void onSetSuccess() {
                                emitSdp(peerId, "answer", answer.description);
                                call.resolve();
                            }
                        }, answer);
                    }

                    @Override
                    public void onCreateFailure(String error) {
                        call.reject(error);
                    }
                }, offerConstraints());
            }

            @Override
            public void onSetFailure(String error) {
                call.reject(error);
            }
        }, new SessionDescription(sdpType, sdp));
    }

    @PluginMethod
    public void addCandidate(PluginCall call) {
        String peerId = call.getString("peerId");
        String candidate = call.getString("candidate");
        if (peerId == null || candidate == null) {
            call.reject("нужны peerId и candidate");
            return;
        }
        String mid = call.getString("sdpMid", "");
        Integer index = call.getInt("sdpMLineIndex", 0);
        peer(peerId).addIceCandidate(new IceCandidate(mid, index == null ? 0 : index, candidate));
        call.resolve();
    }

    @PluginMethod
    public void closePeer(PluginCall call) {
        String peerId = call.getString("peerId");
        if (peerId != null) drop(peerId);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        for (String id : new ArrayList<>(peers.keySet())) drop(id);
        if (audioTrack != null) {
            audioTrack.dispose();
            audioTrack = null;
        }
        if (audioSource != null) {
            audioSource.dispose();
            audioSource = null;
        }
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setSpeakerphoneOn(false);
            am.setMode(previousAudioMode);
        }
        CallForegroundService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setMuted(PluginCall call) {
        Boolean muted = call.getBoolean("muted", false);
        if (audioTrack != null) audioTrack.setEnabled(muted == null || !muted);
        call.resolve();
    }

    // ===== внутреннее =====

    private void ensureFactory() {
        if (factory != null) return;
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(getContext().getApplicationContext())
                .createInitializationOptions());
        EglBase egl = EglBase.create();
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
            .createPeerConnectionFactory();
    }

    private MediaConstraints offerConstraints() {
        MediaConstraints constraints = new MediaConstraints();
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"));
        return constraints;
    }

    private List<PeerConnection.IceServer> parseIceServers(JSArray raw) {
        List<PeerConnection.IceServer> out = new ArrayList<>();
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw.toString());
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                List<String> urls = new ArrayList<>();
                Object u = item.opt("urls");
                if (u instanceof String) {
                    urls.add((String) u);
                } else if (u instanceof JSONArray) {
                    JSONArray ua = (JSONArray) u;
                    for (int j = 0; j < ua.length(); j++) urls.add(ua.getString(j));
                }
                if (urls.isEmpty()) continue;
                PeerConnection.IceServer.Builder b = PeerConnection.IceServer.builder(urls);
                String user = item.optString("username", "");
                String cred = item.optString("credential", "");
                if (!user.isEmpty()) b.setUsername(user);
                if (!cred.isEmpty()) b.setPassword(cred);
                out.add(b.createIceServer());
            }
        } catch (Exception ignored) {}
        return out;
    }

    private synchronized PeerConnection peer(final String peerId) {
        PeerConnection existing = peers.get(peerId);
        if (existing != null) return existing;

        ensureFactory();
        PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(iceServers);
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        config.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY;

        PeerConnection pc = factory.createPeerConnection(config, new PeerObserver(peerId));
        if (pc != null && audioTrack != null) {
            pc.addTrack(audioTrack, Collections.singletonList("hyax"));
        }
        peers.put(peerId, pc);
        return pc;
    }

    private synchronized void drop(String peerId) {
        PeerConnection pc = peers.remove(peerId);
        if (pc != null) pc.close();
    }

    private void emitSdp(String peerId, String type, String sdp) {
        JSObject data = new JSObject();
        data.put("peerId", peerId);
        data.put("type", type);
        data.put("sdp", sdp);
        notifyListeners("sdp", data, true);
    }

    /** Колбэки приходят без участника — наблюдатель помнит, чей он. */
    private class PeerObserver implements PeerConnection.Observer {
        private final String peerId;

        PeerObserver(String peerId) {
            this.peerId = peerId;
        }

        @Override
        public void onIceCandidate(IceCandidate candidate) {
            JSObject data = new JSObject();
            data.put("peerId", peerId);
            data.put("candidate", candidate.sdp);
            data.put("sdpMid", candidate.sdpMid);
            data.put("sdpMLineIndex", candidate.sdpMLineIndex);
            notifyListeners("iceCandidate", data, true);
        }

        @Override
        public void onConnectionChange(PeerConnection.PeerConnectionState newState) {
            JSObject data = new JSObject();
            data.put("peerId", peerId);
            data.put("state", newState.name().toLowerCase());
            notifyListeners("peerState", data, true);
        }

        // Остальное не используем: звук воспроизводит движок, видео и
        // каналы данных в звонках не участвуют.
        @Override public void onSignalingChange(PeerConnection.SignalingState s) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState s) {}
        @Override public void onIceConnectionReceivingChange(boolean b) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState s) {}
        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
        @Override public void onAddStream(MediaStream stream) {}
        @Override public void onRemoveStream(MediaStream stream) {}
        @Override public void onDataChannel(org.webrtc.DataChannel dc) {}
        @Override public void onRenegotiationNeeded() {}
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
    }

    /** Заглушка, чтобы не описывать все четыре метода в каждом вызове. */
    private static class SimpleSdpObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription sdp) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }
}
