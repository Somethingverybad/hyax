package com.huyax.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
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
import org.webrtc.Camera1Enumerator;
import org.webrtc.Camera2Enumerator;
import org.webrtc.CameraEnumerator;
import org.webrtc.CameraVideoCapturer;
import org.webrtc.MediaStreamTrack;
import org.webrtc.RendererCommon;
import org.webrtc.RTCStats;
import org.webrtc.RtpTransceiver;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.SurfaceViewRenderer;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;
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
@CapacitorPlugin(name = "NativeCall", permissions = {
    @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
})
public class NativeCallPlugin extends Plugin {

    private PeerConnectionFactory factory;
    private EglBase egl;
    // ── Видео (личные и групповые звонки) ─────────────────────────────────
    // Видеоканал в соединении есть сразу (пустой) — камера подставляется в
    // него без пересогласования, как в веб-версии. Картинку рисуют
    // SurfaceViewRenderer под прозрачным WebView: кнопки звонка остаются
    // вёрсткой поверх, их места страница сообщает через setVideoLayout.
    private final java.util.Set<String> videoPeers = new java.util.HashSet<>();
    // Демонстрация экрана собеседника — второй видеоканал соединения, только
    // на приём (первый — камера). Его дорожка и окно — под ключом "id#screen".
    private final java.util.Set<String> screenPeers = new java.util.HashSet<>();
    // mid канала демонстрации по участнику — из SDP собеседника (второй видеоканал).
    private final Map<String, String> screenMids = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<String, VideoTrack> remoteVideoTracks = new HashMap<>();
    private VideoSource videoSource;
    private VideoTrack videoTrack;
    private CameraVideoCapturer capturer;
    private SurfaceTextureHelper textureHelper;
    private boolean front = true;
    private boolean cameraPaused = false;
    // Окно на каждого участника с видео и дорожка, к которой оно привязано
    // (только на UI-потоке). over — окно поверх соседних (угловое над демонстрацией).
    private final Map<String, SurfaceViewRenderer> remoteViews = new HashMap<>();
    private final Map<String, Boolean> remoteOver = new HashMap<>();
    private final Map<String, VideoTrack> viewTracks = new HashMap<>();
    private SurfaceViewRenderer localView;
    private Drawable webViewBackground;
    private boolean webTransparent = false;
    private AudioTrack audioTrack;
    private AudioSource audioSource;
    private final Map<String, PeerConnection> peers = new HashMap<>();
    // Входящие дорожки по участнику — для громкости каждого.
    private final Map<String, AudioTrack> remoteTracks = new HashMap<>();
    private final Map<String, Double> peerVolumes = new HashMap<>();
    private List<PeerConnection.IceServer> iceServers = new ArrayList<>();
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    /** Что умеет эта сборка: страница обновляется по воздуху и в старых
     *  сборках, новое она включает только по этому ответу. */
    @PluginMethod
    public void getFeatures(PluginCall call) {
        JSObject r = new JSObject();
        r.put("screen", true);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        ensureFactory();
        iceServers = parseIceServers(call.getArray("iceServers"));

        if (audioTrack == null) {
            // Настройки → Микрофон (из JS): шумодав, эхоподавление и автогромкость
            // движка WebRTC. Аппаратная обработка телефона, если есть, — поверх них.
            JSObject mic = call.getObject("mic");
            MediaConstraints constraints = new MediaConstraints();
            constraints.mandatory.add(new MediaConstraints.KeyValuePair("googNoiseSuppression", micFlag(mic, "noiseSuppression")));
            constraints.mandatory.add(new MediaConstraints.KeyValuePair("googEchoCancellation", micFlag(mic, "echoCancellation")));
            constraints.mandatory.add(new MediaConstraints.KeyValuePair("googAutoGainControl", micFlag(mic, "autoGainControl")));
            audioSource = factory.createAudioSource(constraints);
            audioTrack = factory.createAudioTrack("hyax-audio", audioSource);
            audioTrack.setEnabled(true);
        }

        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            // Нативный движок пишет и играет через голосовой тракт, поэтому
            // режим связи здесь уместен: он же включает эхоподавление.
            // Динамик по умолчанию разговорный, громкая — кнопкой (Voip.setSpeaker).
            previousAudioMode = am.getMode();
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(false);
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
        boolean video = Boolean.TRUE.equals(call.getBoolean("video", false));
        if (video) videoPeers.add(peerId);
        if (video && Boolean.TRUE.equals(call.getBoolean("screen", false))) screenPeers.add(peerId);
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
        }, offerConstraints(peerId));
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
        if (Boolean.TRUE.equals(call.getBoolean("video", false))) videoPeers.add(peerId);
        final PeerConnection pc = peer(peerId);
        SessionDescription.Type sdpType =
            "offer".equals(type) ? SessionDescription.Type.OFFER : SessionDescription.Type.ANSWER;
        // Канал демонстрации узнаём по mid (onTrack): mid второго видеоканала.
        List<String> mids = videoMids(sdp);
        if (mids.size() > 1) screenMids.put(peerId, mids.get(1));

        pc.setRemoteDescription(new SimpleSdpObserver() {
            @Override
            public void onSetSuccess() {
                if (!"offer".equals(type)) {
                    call.resolve();
                    return;
                }
                // Видеоканал из предложения: «и отправляю, и принимаю», чтобы
                // включать камеру без пересогласования. Предложение без
                // видео (старые клиенты) — канала нет, звонок голосовой.
                // Второй видеоканал — демонстрация собеседника: только приём.
                if (videoPeers.contains(peerId)) {
                    int i = 0;
                    for (RtpTransceiver t : pc.getTransceivers()) {
                        if (t.getMediaType() != MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO) continue;
                        if (i++ == 0) {
                            t.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_RECV);
                            t.getSender().setStreams(Collections.singletonList("hyax"));
                            if (videoTrack != null) t.getSender().setTrack(videoTrack, false);
                        } else {
                            t.setDirection(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY);
                            t.getSender().setTrack(null, false);
                        }
                    }
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
                }, offerConstraints(peerId));
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
        stopCamera();
        videoPeers.clear();
        screenPeers.clear();
        screenMids.clear();
        synchronized (remoteVideoTracks) { remoteVideoTracks.clear(); }
        getActivity().runOnUiThread(() -> applyLayout(new ArrayList<>(), null));
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

    /** Громкость участника: 1 — как есть, 0 — тишина, до 2 — громче (AudioTrack.setVolume 0…10). */
    @PluginMethod
    public void setPeerVolume(PluginCall call) {
        String peerId = call.getString("peerId");
        Double volume = call.getDouble("volume", 1.0);
        if (peerId == null) { call.reject("peerId"); return; }
        double v = Math.max(0, Math.min(10, volume == null ? 1.0 : volume));
        synchronized (remoteTracks) {
            peerVolumes.put(peerId, v);
            AudioTrack t = remoteTracks.get(peerId);
            if (t != null) t.setVolume(v);
        }
        call.resolve();
    }

    // ===== видео =====

    /** Камера вкл/выкл. Разрешения нет — спросим; отказ — reject("denied"),
     *  повторное нажатие спросит снова (если не «больше не спрашивать»). */
    @PluginMethod
    public void setVideo(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (!on) {
            setSenders(null);
            stopCamera();
            call.resolve(videoState(false));
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermsCallback");
            return;
        }
        turnOnCamera(call);
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) turnOnCamera(call);
        else call.reject("denied");
    }

    private void turnOnCamera(PluginCall call) {
        if (!startCamera()) { call.reject("no_camera"); return; }
        setSenders(videoTrack);
        call.resolve(videoState(true));
    }

    @PluginMethod
    public void flipCamera(final PluginCall call) {
        if (capturer == null) {
            JSObject r = new JSObject();
            r.put("front", front);
            call.resolve(r);
            return;
        }
        capturer.switchCamera(new CameraVideoCapturer.CameraSwitchHandler() {
            @Override public void onCameraSwitchDone(boolean isFront) {
                front = isFront;
                getActivity().runOnUiThread(() -> { if (localView != null) localView.setMirror(front); });
                JSObject r = new JSObject();
                r.put("front", front);
                call.resolve(r);
            }
            @Override public void onCameraSwitchError(String error) { call.reject(error); }
        });
    }

    /** Настройки приложения в системе: после «больше не спрашивать» доступ
     *  к камере можно дать только там. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Где рисовать видео: прямоугольники в CSS-пикселях относительно WebView.
     *  remote — собеседник, local — своё превью; оба null — видео нет. */
    @PluginMethod
    public void setVideoLayout(PluginCall call) {
        final List<JSObject> remotes = new ArrayList<>();
        JSArray arr = call.getArray("remotes");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                try { remotes.add(JSObject.fromJSONObject(o)); } catch (Exception ignored) {}
            }
        }
        final JSObject local = call.getObject("local");
        getActivity().runOnUiThread(() -> {
            applyLayout(remotes, local);
            call.resolve();
        });
    }

    /** Кто говорит: уровень входящего звука по каждому соединению и свой
     *  микрофон (0…1) — из статистики WebRTC. */
    @PluginMethod
    public void getAudioLevels(PluginCall call) {
        final Map<String, PeerConnection> snapshot;
        synchronized (this) { snapshot = new HashMap<>(peers); }
        final JSObject levels = new JSObject();
        final double[] local = { 0 };
        if (snapshot.isEmpty()) {
            JSObject out = new JSObject();
            out.put("peers", levels);
            out.put("local", 0);
            call.resolve(out);
            return;
        }
        final java.util.concurrent.atomic.AtomicInteger left = new java.util.concurrent.atomic.AtomicInteger(snapshot.size());
        for (Map.Entry<String, PeerConnection> e : snapshot.entrySet()) {
            final String id = e.getKey();
            e.getValue().getStats(report -> {
                double in = 0, out = 0;
                for (RTCStats st : report.getStatsMap().values()) {
                    Map<String, Object> m = st.getMembers();
                    if (!"audio".equals(m.get("kind")) || !(m.get("audioLevel") instanceof Number)) continue;
                    double level = ((Number) m.get("audioLevel")).doubleValue();
                    Object rs = m.get("remoteSource");
                    if ("inbound-rtp".equals(st.getType()) || ("track".equals(st.getType()) && Boolean.TRUE.equals(rs))) in = Math.max(in, level);
                    else if ("media-source".equals(st.getType()) || ("track".equals(st.getType()) && Boolean.FALSE.equals(rs))) out = Math.max(out, level);
                }
                synchronized (levels) {
                    try { levels.put(id, in); } catch (Exception ignored) {}
                    local[0] = Math.max(local[0], out);
                }
                if (left.decrementAndGet() == 0) {
                    JSObject res = new JSObject();
                    synchronized (levels) {
                        res.put("peers", levels);
                        res.put("local", local[0]);
                    }
                    call.resolve(res);
                }
            });
        }
    }

    private JSObject videoState(boolean on) {
        JSObject r = new JSObject();
        r.put("on", on);
        r.put("front", front);
        r.put("canFlip", cameraNames(enumerator()).size() > 1);
        return r;
    }

    private CameraEnumerator enumerator() {
        return Camera2Enumerator.isSupported(getContext()) ? new Camera2Enumerator(getContext()) : new Camera1Enumerator(false);
    }

    private List<String> cameraNames(CameraEnumerator en) {
        List<String> out = new ArrayList<>();
        for (String n : en.getDeviceNames()) out.add(n);
        return out;
    }

    private synchronized boolean startCamera() {
        if (capturer != null) return true;
        ensureFactory();
        CameraEnumerator en = enumerator();
        String pick = null;
        for (String n : en.getDeviceNames()) if (en.isFrontFacing(n) == front) { pick = n; break; }
        if (pick == null && en.getDeviceNames().length > 0) pick = en.getDeviceNames()[0];
        if (pick == null) return false;
        front = en.isFrontFacing(pick);
        capturer = en.createCapturer(pick, null);
        if (capturer == null) return false;
        textureHelper = SurfaceTextureHelper.create("hyax-camera", egl.getEglBaseContext());
        videoSource = factory.createVideoSource(false);
        capturer.initialize(textureHelper, getContext(), videoSource.getCapturerObserver());
        capturer.startCapture(1280, 720, 30);
        videoTrack = factory.createVideoTrack("hyax-video", videoSource);
        final VideoTrack t = videoTrack;
        getActivity().runOnUiThread(() -> {
            if (localView != null) { t.addSink(localView); localView.setMirror(front); }
        });
        return true;
    }

    private synchronized void stopCamera() {
        final VideoTrack t = videoTrack;
        final SurfaceViewRenderer lv = localView;
        if (t != null && lv != null) getActivity().runOnUiThread(() -> t.removeSink(lv));
        if (capturer != null) {
            try { capturer.stopCapture(); } catch (InterruptedException ignored) {}
            capturer.dispose();
            capturer = null;
        }
        if (textureHelper != null) { textureHelper.dispose(); textureHelper = null; }
        if (videoSource != null) { videoSource.dispose(); videoSource = null; }
        videoTrack = null;
        cameraPaused = false;
    }

    /** Камера — только в первый видеоканал (второй — демонстрация собеседника). */
    private synchronized void setSenders(VideoTrack track) {
        for (Map.Entry<String, PeerConnection> e : peers.entrySet()) {
            if (!videoPeers.contains(e.getKey())) continue;
            for (RtpTransceiver t : e.getValue().getTransceivers()) {
                if (t.getMediaType() == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO) { t.getSender().setTrack(track, false); break; }
            }
        }
    }

    // Свернули приложение — камеру отпускаем (в фоне Android её не даёт),
    // вернулись — включаем снова. Голос при этом не прерывается.
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (capturer != null) {
            try { capturer.stopCapture(); cameraPaused = true; } catch (InterruptedException ignored) {}
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (capturer != null && cameraPaused) { capturer.startCapture(1280, 720, 30); cameraPaused = false; }
    }

    private SurfaceViewRenderer makeRenderer(boolean overlay) {
        SurfaceViewRenderer v = new SurfaceViewRenderer(getContext());
        v.init(egl.getEglBaseContext(), null);
        v.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL);
        // Без аппаратного масштабирования: с ним поверхность подгоняется под
        // разрешение кадра, и когда собеседник поднимал качество (540p → 720p),
        // картинка оставалась в старом размере — справа чёрная полоса.
        v.setEnableHardwareScaler(false);
        // Своё превью — поверх окна собеседника, но всё равно под WebView.
        v.setZOrderMediaOverlay(overlay);
        return v;
    }

    /** Нативные окна под WebView (на UI-потоке): по окну на участника с
     *  видео и своё превью. Видео есть — WebView прозрачный. Углы окон
     *  скругляет страница (рисует фон вокруг), сами SurfaceView прямоугольные. */
    private void applyLayout(List<JSObject> remotes, JSObject local) {
        WebView web = getBridge().getWebView();
        if (web == null || !(web.getParent() instanceof ViewGroup)) return;
        ViewGroup host = (ViewGroup) web.getParent();
        float d = getContext().getResources().getDisplayMetrics().density;
        boolean hasLocal = local != null && local.optDouble("w", 0) > 0;
        ensureFactory();
        java.util.Set<String> wanted = new java.util.HashSet<>();
        for (JSObject r : remotes) {
            String id = r.getString("peerId");
            if (id != null && r.optDouble("w", 0) > 0) wanted.add(id);
        }
        // Ушедшие и те, кто выключил камеру, — без окна. Окно, которому
        // нужно встать поверх соседних (или наоборот), — заново: слой
        // SurfaceView задаётся только до показа.
        java.util.Map<String, Boolean> overs = new HashMap<>();
        for (JSObject r : remotes) {
            String id = r.getString("peerId");
            if (id != null) overs.put(id, r.optBoolean("over", false));
        }
        for (String id : new ArrayList<>(remoteViews.keySet())) {
            if (wanted.contains(id) && overs.get(id).equals(remoteOver.get(id))) continue;
            SurfaceViewRenderer v = remoteViews.remove(id);
            remoteOver.remove(id);
            VideoTrack t = viewTracks.remove(id);
            if (t != null) t.removeSink(v);
            host.removeView(v);
            v.release();
        }
        for (JSObject r : remotes) {
            String id = r.getString("peerId");
            if (id == null || !wanted.contains(id)) continue;
            SurfaceViewRenderer v = remoteViews.get(id);
            if (v == null) {
                boolean over = Boolean.TRUE.equals(overs.get(id));
                v = makeRenderer(over);
                host.addView(v, over ? Math.max(0, host.indexOfChild(web)) : 0, new ViewGroup.LayoutParams(1, 1));
                remoteViews.put(id, v);
                remoteOver.put(id, over);
            }
            // Демонстрация — кадр целиком, камеры — с обрезкой по окну.
            v.setScalingType(r.optBoolean("fit", false) ? RendererCommon.ScalingType.SCALE_ASPECT_FIT : RendererCommon.ScalingType.SCALE_ASPECT_FILL);
            // Дорожка могла смениться (переподключение) — привязываем актуальную.
            VideoTrack t;
            synchronized (remoteVideoTracks) { t = remoteVideoTracks.get(id); }
            if (t != null && viewTracks.get(id) != t) {
                VideoTrack old = viewTracks.get(id);
                if (old != null) old.removeSink(v);
                t.addSink(v);
                viewTracks.put(id, t);
            }
            place(v, r, d, web);
            v.setVisibility(View.VISIBLE);
        }
        if (hasLocal) {
            if (localView == null) {
                localView = makeRenderer(true);
                host.addView(localView, Math.max(0, host.indexOfChild(web)), new ViewGroup.LayoutParams(1, 1));
                localView.setMirror(front);
                if (videoTrack != null) videoTrack.addSink(localView);
            }
            place(localView, local, d, web);
            localView.setVisibility(View.VISIBLE);
        } else if (localView != null) {
            localView.setVisibility(View.GONE);
        }
        boolean any = !wanted.isEmpty() || hasLocal;
        if (any && !webTransparent) {
            webViewBackground = web.getBackground();
            web.setBackgroundColor(Color.TRANSPARENT);
            webTransparent = true;
        } else if (!any && webTransparent) {
            web.setBackground(webViewBackground);
            webTransparent = false;
            if (localView != null) {
                if (videoTrack != null) videoTrack.removeSink(localView);
                host.removeView(localView); localView.release(); localView = null;
            }
        }
    }

    private static void place(View v, JSObject r, float d, View web) {
        ViewGroup.LayoutParams lp = v.getLayoutParams();
        lp.width = Math.round((float) r.optDouble("w", 0) * d);
        lp.height = Math.round((float) r.optDouble("h", 0) * d);
        v.setLayoutParams(lp);
        v.setX(web.getX() + (float) r.optDouble("x", 0) * d);
        v.setY(web.getY() + (float) r.optDouble("y", 0) * d);
    }

    // ===== внутреннее =====

    /** Флаг настройки микрофона для ограничений WebRTC: выключен только явным false. */
    private static String micFlag(JSObject mic, String key) {
        return mic != null && mic.has(key) && !mic.optBoolean(key, true) ? "false" : "true";
    }

    private void ensureFactory() {
        if (factory != null) return;
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(getContext().getApplicationContext())
                .createInitializationOptions());
        egl = EglBase.create();
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
            .createPeerConnectionFactory();
    }

    private MediaConstraints offerConstraints(String peerId) {
        MediaConstraints constraints = new MediaConstraints();
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", videoPeers.contains(peerId) ? "true" : "false"));
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
        // Звонящий с видео: пустой видеоканал сразу (отвечающий получит его
        // из предложения — см. setRemoteDescription).
        if (pc != null && videoPeers.contains(peerId)) {
            RtpTransceiver t = pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, Collections.singletonList("hyax")));
            if (videoTrack != null) t.getSender().setTrack(videoTrack, false);
            // Собеседник умеет показывать экран — второй канал под демонстрацию.
            if (screenPeers.contains(peerId)) {
                pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                    new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
            }
        }
        peers.put(peerId, pc);
        return pc;
    }

    private synchronized void drop(String peerId) {
        PeerConnection pc = peers.remove(peerId);
        if (pc != null) pc.close();
        screenPeers.remove(peerId);
        screenMids.remove(peerId);
        synchronized (remoteVideoTracks) {
            remoteVideoTracks.remove(peerId);
            remoteVideoTracks.remove(peerId + "#screen");
        }
    }

    /** mid видеоканалов по порядку в SDP. */
    private static List<String> videoMids(String sdp) {
        List<String> out = new ArrayList<>();
        boolean video = false;
        for (String line : sdp.split("\r?\n")) {
            if (line.startsWith("m=")) video = line.startsWith("m=video");
            else if (video && line.startsWith("a=mid:")) out.add(line.substring(6).trim());
        }
        return out;
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
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {
            // Дорожка участника — запоминаем и применяем громкость, если её
            // выставили раньше, чем дорожка появилась.
            if (receiver.track() instanceof AudioTrack) {
                AudioTrack t = (AudioTrack) receiver.track();
                synchronized (remoteTracks) {
                    remoteTracks.put(peerId, t);
                    Double v = peerVolumes.get(peerId);
                    if (v != null) t.setVolume(v);
                }
            }
            // Видео — в onTrack: там видно, какой это канал.
        }

        @Override public void onTrack(RtpTransceiver transceiver) {
            RtpReceiver receiver = transceiver.getReceiver();
            if (!(receiver.track() instanceof VideoTrack)) return;
            // Второй видеоканал — демонстрация экрана, своим окном, не вместо камеры.
            String mid = transceiver.getMid();
            final String key = mid != null && mid.equals(screenMids.get(peerId)) ? peerId + "#screen" : peerId;
            final VideoTrack vt = (VideoTrack) receiver.track();
            synchronized (remoteVideoTracks) { remoteVideoTracks.put(key, vt); }
            getActivity().runOnUiThread(() -> {
                SurfaceViewRenderer v = remoteViews.get(key);
                if (v == null) return;
                VideoTrack old = viewTracks.get(key);
                if (old != null) old.removeSink(v);
                vt.addSink(v);
                viewTracks.put(key, vt);
            });
        }
    }

    /** Заглушка, чтобы не описывать все четыре метода в каждом вызове. */
    private static class SimpleSdpObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription sdp) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }
}
