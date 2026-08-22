import json
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from jwt import decode as jwt_decode
from .models import Chat, Profile, ChatParticipant, CallSession, CallParticipant
from django.contrib.auth import get_user_model

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.chat_id = self.scope['url_route']['kwargs']['chat_id']
        self.chat_group_name = f'chat_{self.chat_id}'
        self.user = self.scope.get('user', AnonymousUser())

        # Проверка аутентификации через JWT токен
        if isinstance(self.user, AnonymousUser):
            # Попытка аутентификации через JWT токен в query параметрах
            query_string = self.scope.get('query_string', b'').decode()
            token_key = None
            
            # Пытаемся получить токен из query параметров
            if 'token=' in query_string:
                token_key = query_string.split('token=')[-1].split('&')[0]
            elif 'access_token=' in query_string:
                token_key = query_string.split('access_token=')[-1].split('&')[0]
            
            if token_key:
                try:
                    # Валидация JWT токена
                    UntypedToken(token_key)
                    # Декодируем токен без проверки подписи (UntypedToken уже проверил)
                    decoded_data = jwt_decode(token_key, options={"verify_signature": False})
                    user_id = decoded_data.get('user_id')
                    if user_id:
                        self.user = await database_sync_to_async(User.objects.get)(id=user_id)
                except (InvalidToken, TokenError, User.DoesNotExist) as e:
                    print(f"❌ [WS] токен отклонён: {type(e).__name__}: {e}")
                    await self.close(code=4001)
                    return

        # Проверка аутентификации асинхронно
        is_authenticated = await self.check_user_authenticated(self.user)
        if not is_authenticated:
            await self.close()
            return

        # Проверка доступа к чату
        has_access = await self.check_chat_access(self.chat_id, self.user)
        if not has_access:
            await self.close()
            return

        # Присоединение к группе
        await self.channel_layer.group_add(
            self.chat_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        # Отключение от группы
        await self.channel_layer.group_discard(
            self.chat_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type')

            if message_type == 'ping':
                # Отправка pong для поддержания соединения
                await self.send(text_data=json.dumps({
                    'type': 'pong'
                }))
                return

            if message_type in {
                "call_invite",
                "call_accept",
                "call_reject",
                "call_end",
                "webrtc_offer",
                "webrtc_answer",
                "webrtc_ice_candidate",
            }:
                await self.handle_call_signal(message_type, text_data_json)
        except json.JSONDecodeError:
            pass

    async def handle_call_signal(self, signal_type, payload):
        profile_id = await self.get_user_profile_id(self.user)
        if not profile_id:
            return

        data = payload.get("data") or {}
        call_id = data.get("call_id")
        chat_id = data.get("chat_id") or self.chat_id
        target_user_id = data.get("to_user_id")

        if signal_type == "call_invite":
            call_type = data.get("call_type", "audio")
            session_payload = await self.create_or_get_call_session(
                chat_id=chat_id,
                initiator_id=profile_id,
                target_user_id=target_user_id,
                call_id=call_id,
                call_type=call_type,
            )
            if not session_payload:
                return
            data = {**data, **session_payload}
            target_user_id = data.get("to_user_id")

            # Получаем информацию о звонящем пользователе
            try:
                profile = await database_sync_to_async(Profile.objects.get)(id=profile_id)
                from_username = profile.username
                from_user_avatar = profile.avatar_url
                
                # Обновляем статус звонка - звонящий
                profile.call_status = "calling"
                await database_sync_to_async(profile.save)()
                
                print(f"📞 [call_invite] from_username={from_username}, from_user_avatar={from_user_avatar}")
            except Profile.DoesNotExist:
                from_username = "Неизвестный"
                from_user_avatar = None
                print(f"❌ [call_invite] Profile not found for id={profile_id}")

            if target_user_id:
                print(f"📤 Отправка уведомления о звонке пользователю {target_user_id}")
                print(f"   from_username={from_username}, from_user_avatar={from_user_avatar}")
                
                await self.channel_layer.group_send(
                    f"user_{target_user_id}",
                    {
                        "type": "notification",
                        "data": {
                            "type": "incoming_call",
                            "chat_id": str(chat_id),
                            "call_id": str(data["call_id"]),
                            "from_user_id": str(profile_id),
                            "from_username": from_username,
                            "from_user_avatar": from_user_avatar,
                            "call_type": data.get("call_type", "audio"),
                        },
                    },
                )

                # Пуш: у свёрнутого приложения WebSocket молчит — звоним через
                # APNs/FCM звуком «Звонок» (до 30 с — лимит Apple на звук пуша).
                try:
                    from .fcm import notify_profiles, notify_data
                    from .apns_voip import notify_voip
                    is_video = data.get("call_type", "audio") == "video"
                    callee = Profile.objects.filter(id=target_user_id)
                    call_payload = {
                        "type": "incoming_call",
                        "call_id": str(data["call_id"]),
                        "chat_id": str(chat_id),
                        "from_user_id": str(profile_id),
                        "from_username": from_username,
                        "from_user_avatar": from_user_avatar or "",
                        "call_type": data.get("call_type", "audio"),
                    }
                    # iOS: PushKit будит приложение и показывает CallKit даже на
                    # заблокированном экране. Обычный пуш — тем, у кого VoIP-токена
                    # нет (Android, старые сборки), иначе iPhone звонил бы дважды.
                    voip_sent = await database_sync_to_async(notify_voip)(callee, call_payload)
                    # Android: только данные — нативный сервис рисует полноэкранный
                    # вызов сам; ttl 30 с, чтобы звонок не «догнал» телефон позже.
                    await database_sync_to_async(notify_data)(callee, call_payload, platforms=["android"], ttl=30)
                    if not voip_sent:
                        await database_sync_to_async(notify_profiles)(
                            callee,
                            title=from_username,
                            body="Входящий видеозвонок" if is_video else "Входящий звонок",
                            extra=call_payload,
                            sound="call",
                            platforms=["ios"],
                        )
                except Exception as e:
                    print(f"❌ [call_invite] push не отправлен: {e}")
        else:
            if not call_id:
                return
            is_participant = await self.is_call_participant(call_id, profile_id, chat_id)
            if not is_participant:
                return

            if signal_type == "call_accept":
                await self.update_call_status(call_id, "active", profile_id, mark_joined=True)
                # Обновляем статусы обоих пользователей
                await self.set_profile_call_status(profile_id, "in_call")
                # Найти другого участника и тоже установить in_call
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                initiator_id = call_session.initiator_id
                other_user_id = target_user_id if str(profile_id) == str(initiator_id) else initiator_id
                if other_user_id:
                    await self.set_profile_call_status(other_user_id, "in_call")
            elif signal_type == "call_reject":
                await self.update_call_status(call_id, "rejected", profile_id, close_call=True)
                # Сбрасываем статусы
                await self.set_profile_call_status(profile_id, "idle")
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                if call_session.initiator_id:
                    await self.set_profile_call_status(call_session.initiator_id, "idle")
            elif signal_type == "call_end":
                end_status = data.get("status") or "ended"
                if end_status not in {"ended", "missed", "failed"}:
                    end_status = "ended"
                await self.update_call_status(call_id, end_status, profile_id, close_call=True, mark_left=True)
                # Сбрасываем статусы обоих пользователей
                await self.set_profile_call_status(profile_id, "idle")
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                if call_session.initiator_id:
                    await self.set_profile_call_status(call_session.initiator_id, "idle")

        # Отбой/отклонение: тихим пушем убираем экран вызова у второй стороны —
        # её WebSocket в фоне может молчать, а CallKit иначе звонит до таймаута.
        if signal_type in ("call_reject", "call_end") and call_id:
            try:
                from .fcm import notify_data
                _session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                _other = target_user_id if str(profile_id) == str(_session.initiator_id) else _session.initiator_id
                if _other:
                    await database_sync_to_async(notify_data)(
                        Profile.objects.filter(id=_other),
                        {"type": "call_ended", "call_id": str(call_id)},
                    )
            except Exception as e:
                print(f"❌ [{signal_type}] тихий пуш не отправлен: {e}")

        # Отправляем call_signal в группу чата (для совместимости)
        await self.channel_layer.group_send(
            self.chat_group_name,
            {
                "type": "call_signal",
                "signal_type": signal_type,
                "data": {
                    **data,
                    "call_id": str(data.get("call_id")) if data.get("call_id") else None,
                    "chat_id": str(chat_id),
                    "from_user_id": str(profile_id),
                },
            },
        )
        
        # ТАКЖЕ отправляем в персональные каналы всех участников звонка
        if signal_type in ["call_accept", "call_reject", "call_end"]:
            # Эти сигналы нужны звонящему
            try:
                call_session = await database_sync_to_async(CallSession.objects.get)(id=data.get("call_id"))
                initiator_id = call_session.initiator_id
                
                # Отправляем инициатору если мы не инициатор
                if initiator_id and str(initiator_id) != str(profile_id):
                    print(f"📞 Отправка {signal_type} инициатору {initiator_id}")
                    await self.channel_layer.group_send(
                        f"user_{initiator_id}",
                        {
                            "type": "call_signal_notification",
                            "signal_type": signal_type,
                            "data": {
                                **data,
                                "call_id": str(data.get("call_id")),
                                "chat_id": str(chat_id),
                                "from_user_id": str(profile_id),
                            },
                        },
                    )
            except Exception as e:
                print(f"Ошибка отправки call_signal: {e}")
        
        # WebRTC сигналы отправляем целевому пользователю
        if target_user_id and signal_type in ["webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"]:
            print(f"📞 Отправка {signal_type} пользователю {target_user_id}")
            await self.channel_layer.group_send(
                f"user_{target_user_id}",
                {
                    "type": "call_signal_notification",
                    "signal_type": signal_type,
                    "data": {
                        **data,
                        "call_id": str(data.get("call_id")) if data.get("call_id") else None,
                        "chat_id": str(chat_id),
                        "from_user_id": str(profile_id),
                    },
                },
            )

    # Получение сообщения из группы
    async def chat_message(self, event):
        # Преобразуем UUID в строки перед сериализацией
        def convert_uuid_to_str(obj):
            """Рекурсивно преобразует UUID в строки"""
            if isinstance(obj, uuid.UUID):
                return str(obj)
            elif isinstance(obj, dict):
                return {k: convert_uuid_to_str(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_uuid_to_str(item) for item in obj]
            elif isinstance(obj, tuple):
                return tuple(convert_uuid_to_str(item) for item in obj)
            else:
                return obj
        
        try:
            message = convert_uuid_to_str(event.get('message', {}))
            await self.send(text_data=json.dumps({
                'type': 'new_message',
                'message': message
            }))
        except Exception as e:
            print(f"Error sending chat message: {e}")
            # Если ошибка при отправке, просто пропускаем

    async def call_signal(self, event):
        try:
            await self.send(text_data=json.dumps({
                "type": "call_signal",
                "signal_type": event.get("signal_type"),
                "data": event.get("data", {}),
            }))
        except Exception as e:
            print(f"Error sending call signal: {e}")

    @database_sync_to_async
    def check_user_authenticated(self, user):
        """Проверка аутентификации пользователя"""
        return user.is_authenticated
    
    @database_sync_to_async
    def check_chat_access(self, chat_id, user):
        """Проверка доступа пользователя к чату"""
        try:
            profile = user.profile
            chat = Chat.objects.get(id=chat_id)
            return ChatParticipant.objects.filter(chat=chat, user=profile).exists()
        except (Profile.DoesNotExist, Chat.DoesNotExist):
            return False

    @database_sync_to_async
    def get_user_profile_id(self, user):
        try:
            return str(user.profile.id)
        except Profile.DoesNotExist:
            return None

    @database_sync_to_async
    def create_or_get_call_session(self, chat_id, initiator_id, target_user_id, call_id=None, call_type="audio"):
        try:
            chat = Chat.objects.get(id=chat_id)
            initiator = Profile.objects.get(id=initiator_id)
        except (Chat.DoesNotExist, Profile.DoesNotExist):
            return None

        if call_type not in {"audio", "video"}:
            call_type = "audio"

        if target_user_id:
            try:
                target = Profile.objects.get(id=target_user_id)
            except Profile.DoesNotExist:
                return None
        else:
            target = ChatParticipant.objects.filter(chat=chat).exclude(user=initiator).values_list("user", flat=True).first()
            if not target:
                return None
            target = Profile.objects.get(id=target)

        initiator_in_chat = ChatParticipant.objects.filter(chat=chat, user=initiator).exists()
        target_in_chat = ChatParticipant.objects.filter(chat=chat, user=target).exists()
        if not initiator_in_chat or not target_in_chat:
            return None

        if call_id:
            try:
                call_session = CallSession.objects.get(id=call_id, chat=chat)
            except CallSession.DoesNotExist:
                try:
                    parsed_call_id = uuid.UUID(str(call_id))
                except (ValueError, TypeError):
                    return None

                call_session = CallSession.objects.create(
                    id=parsed_call_id,
                    chat=chat,
                    initiator=initiator,
                    call_type=call_type,
                    status="ringing",
                )
                CallParticipant.objects.get_or_create(call=call_session, user=initiator)
                CallParticipant.objects.get_or_create(call=call_session, user=target)
        else:
            call_session = CallSession.objects.create(
                chat=chat,
                initiator=initiator,
                call_type=call_type,
                status="ringing",
            )
            CallParticipant.objects.get_or_create(call=call_session, user=initiator)
            CallParticipant.objects.get_or_create(call=call_session, user=target)

        return {
            "call_id": str(call_session.id),
            "chat_id": str(chat.id),
            "to_user_id": str(target.id),
            "call_type": call_session.call_type,
        }

    @database_sync_to_async
    def is_call_participant(self, call_id, profile_id, chat_id):
        return CallParticipant.objects.filter(
            call_id=call_id,
            user_id=profile_id,
            call__chat_id=chat_id,
        ).exists()

    @database_sync_to_async
    def update_call_status(self, call_id, status, user_id, close_call=False, mark_joined=False, mark_left=False):
        try:
            call_session = CallSession.objects.get(id=call_id)
        except CallSession.DoesNotExist:
            return

        if mark_joined:
            participant, _ = CallParticipant.objects.get_or_create(call=call_session, user_id=user_id)
            if participant.joined_at is None:
                participant.joined_at = timezone.now()
                participant.save(update_fields=["joined_at"])

        if mark_left:
            participant = CallParticipant.objects.filter(call=call_session, user_id=user_id).first()
            if participant and participant.left_at is None:
                participant.left_at = timezone.now()
                participant.save(update_fields=["left_at"])

        if status:
            call_session.status = status
        if close_call:
            call_session.ended_at = timezone.now()
            call_session.ended_by_id = user_id
        if status == "active" and call_session.started_at is None:
            call_session.started_at = timezone.now()
        call_session.save(update_fields=["status", "ended_at", "ended_by", "started_at"])


class UserConsumer(AsyncWebsocketConsumer):
    """Consumer для отправки уведомлений конкретному пользователю"""
    async def connect(self):
        try:
            self.user_id = self.scope['url_route']['kwargs']['user_id']
            self.user_group_name = f'user_{self.user_id}'
            self.user = self.scope.get('user', AnonymousUser())

            # Проверка аутентификации через JWT токен
            if isinstance(self.user, AnonymousUser):
                query_string = self.scope.get('query_string', b'').decode()
                token_key = None

                if 'token=' in query_string:
                    token_key = query_string.split('token=')[-1].split('&')[0]
                elif 'access_token=' in query_string:
                    token_key = query_string.split('access_token=')[-1].split('&')[0]

                if token_key:
                    try:
                        UntypedToken(token_key)
                        decoded_data = jwt_decode(token_key, options={"verify_signature": False})
                        user_id = decoded_data.get('user_id')
                        if user_id:
                            self.user = await database_sync_to_async(User.objects.get)(id=user_id)
                    except (InvalidToken, TokenError, User.DoesNotExist) as e:
                        print(f"❌ [WS user] токен отклонён: {type(e).__name__}: {e}")
                        await self.close(code=4001)
                        return

            # Проверка аутентификации асинхронно
            is_authenticated = await self.check_user_authenticated(self.user)
            if not is_authenticated:
                await self.close()
                return

            # Проверка, что user_id из токена совпадает с user_id из URL
            profile = await self.get_user_profile(self.user)
            if not profile:
                await self.close()
                return

            profile_id_str = await self.get_profile_id_string(profile)
            if profile_id_str != self.user_id:
                await self.close()
                return

            # Присоединение к группе
            await self.channel_layer.group_add(
                self.user_group_name,
                self.channel_name
            )

            await self.accept()
            print(f"✅ [UserConsumer] Подключен user_id={self.user_id}")
        except Exception as e:
            print(f"❌ [UserConsumer] Ошибка connect: {e}")
            import traceback
            traceback.print_exc()
            raise

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.user_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type')

            if message_type == 'ping':
                await self.send(text_data=json.dumps({
                    'type': 'pong'
                }))
                return
            
            # Обработка звонков через персональный канал
            if message_type in {
                "call_invite",
                "call_accept",
                "call_reject",
                "call_end",
                "webrtc_offer",
                "webrtc_answer",
                "webrtc_ice_candidate",
            }:
                print(f"📞 [UserConsumer] Получен {message_type}")
                await self.handle_call_signal(message_type, text_data_json)
        except json.JSONDecodeError:
            pass
    
    async def handle_call_signal(self, signal_type, payload):
        """Обработка звонков через персональный канал"""
        profile_id = await self.get_user_profile_id(self.user)
        if not profile_id:
            print("❌ [UserConsumer] Профиль не найден")
            return

        data = payload.get("data") or {}
        call_id = data.get("call_id")
        chat_id = data.get("chat_id")
        target_user_id = data.get("to_user_id")

        print(f"📞 [UserConsumer.handle_call_signal] {signal_type}")
        print(f"   profile_id={profile_id}, chat_id={chat_id}, target_user_id={target_user_id}")

        if signal_type == "call_invite":
            call_type = data.get("call_type", "audio")
            session_payload = await self.create_or_get_call_session(
                chat_id=chat_id,
                initiator_id=profile_id,
                target_user_id=target_user_id,
                call_id=call_id,
                call_type=call_type,
            )
            if not session_payload:
                print("❌ [UserConsumer] Не удалось создать сессию звонка")
                return
            data = {**data, **session_payload}
            target_user_id = data.get("to_user_id")

            # Получаем информацию о звонящем пользователе
            try:
                profile = await database_sync_to_async(Profile.objects.get)(id=profile_id)
                from_username = profile.username
                from_user_avatar = profile.avatar_url
                
                # Обновляем статус звонка - звонящий
                profile.call_status = "calling"
                await database_sync_to_async(profile.save)()
                
                print(f"📞 [call_invite] from_username={from_username}, from_user_avatar={from_user_avatar}")
            except Profile.DoesNotExist:
                from_username = "Неизвестный"
                from_user_avatar = None
                print(f"❌ [call_invite] Profile not found for id={profile_id}")

            if target_user_id:
                print(f"📤 Отправка уведомления о звонке пользователю {target_user_id}")
                print(f"   from_username={from_username}, from_user_avatar={from_user_avatar}")
                
                await self.channel_layer.group_send(
                    f"user_{target_user_id}",
                    {
                        "type": "notification",
                        "data": {
                            "type": "incoming_call",
                            "chat_id": str(chat_id),
                            "call_id": str(data["call_id"]),
                            "from_user_id": str(profile_id),
                            "from_username": from_username,
                            "from_user_avatar": from_user_avatar,
                            "call_type": data.get("call_type", "audio"),
                        },
                    },
                )

                # Пуш: у свёрнутого приложения WebSocket молчит — звоним через
                # APNs/FCM звуком «Звонок» (до 30 с — лимит Apple на звук пуша).
                try:
                    from .fcm import notify_profiles, notify_data
                    from .apns_voip import notify_voip
                    is_video = data.get("call_type", "audio") == "video"
                    callee = Profile.objects.filter(id=target_user_id)
                    call_payload = {
                        "type": "incoming_call",
                        "call_id": str(data["call_id"]),
                        "chat_id": str(chat_id),
                        "from_user_id": str(profile_id),
                        "from_username": from_username,
                        "from_user_avatar": from_user_avatar or "",
                        "call_type": data.get("call_type", "audio"),
                    }
                    # iOS: PushKit будит приложение и показывает CallKit даже на
                    # заблокированном экране. Обычный пуш — тем, у кого VoIP-токена
                    # нет (Android, старые сборки), иначе iPhone звонил бы дважды.
                    voip_sent = await database_sync_to_async(notify_voip)(callee, call_payload)
                    # Android: только данные — нативный сервис рисует полноэкранный
                    # вызов сам; ttl 30 с, чтобы звонок не «догнал» телефон позже.
                    await database_sync_to_async(notify_data)(callee, call_payload, platforms=["android"], ttl=30)
                    if not voip_sent:
                        await database_sync_to_async(notify_profiles)(
                            callee,
                            title=from_username,
                            body="Входящий видеозвонок" if is_video else "Входящий звонок",
                            extra=call_payload,
                            sound="call",
                            platforms=["ios"],
                        )
                except Exception as e:
                    print(f"❌ [call_invite] push не отправлен: {e}")
        else:
            # Другие сигналы - call_accept, call_reject, webrtc_*
            if not call_id:
                return
            is_participant = await self.is_call_participant(call_id, profile_id, chat_id)
            if not is_participant:
                print(f"❌ [UserConsumer] Пользователь {profile_id} не участник звонка {call_id}")
                return

            if signal_type == "call_accept":
                await self.update_call_status(call_id, "active", profile_id, mark_joined=True)
                await self.set_profile_call_status(profile_id, "in_call")
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                initiator_id = call_session.initiator_id
                other_user_id = target_user_id if str(profile_id) == str(initiator_id) else initiator_id
                if other_user_id:
                    await self.set_profile_call_status(other_user_id, "in_call")
            elif signal_type == "call_reject":
                await self.update_call_status(call_id, "rejected", profile_id, close_call=True)
                await self.set_profile_call_status(profile_id, "idle")
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                if call_session.initiator_id:
                    await self.set_profile_call_status(call_session.initiator_id, "idle")
            elif signal_type == "call_end":
                end_status = data.get("status") or "ended"
                if end_status not in {"ended", "missed", "failed"}:
                    end_status = "ended"
                await self.update_call_status(call_id, end_status, profile_id, close_call=True, mark_left=True)
                await self.set_profile_call_status(profile_id, "idle")
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                if call_session.initiator_id:
                    await self.set_profile_call_status(call_session.initiator_id, "idle")

        # Отбой/отклонение: тихим пушем убираем экран вызова у второй стороны —
        # её WebSocket в фоне может молчать, а CallKit иначе звонит до таймаута.
        if signal_type in ("call_reject", "call_end") and call_id:
            try:
                from .fcm import notify_data
                _session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                _other = target_user_id if str(profile_id) == str(_session.initiator_id) else _session.initiator_id
                if _other:
                    await database_sync_to_async(notify_data)(
                        Profile.objects.filter(id=_other),
                        {"type": "call_ended", "call_id": str(call_id)},
                    )
            except Exception as e:
                print(f"❌ [{signal_type}] тихий пуш не отправлен: {e}")

        # Отправляем сигналы в персональные каналы участников
        if signal_type in ["call_accept", "call_reject", "call_end"]:
            try:
                call_session = await database_sync_to_async(CallSession.objects.get)(id=call_id)
                initiator_id = str(call_session.initiator_id) if call_session.initiator_id else None
                
                print(f"📞 Проверка отправки {signal_type}: initiator_id={initiator_id}, profile_id={profile_id}")
                
                if initiator_id and initiator_id != str(profile_id):
                    print(f"📞 Отправка {signal_type} инициатору {initiator_id}")
                    await self.channel_layer.group_send(
                        f"user_{initiator_id}",
                        {
                            "type": "call_signal_notification",
                            "signal_type": signal_type,
                            "data": {
                                **data,
                                "call_id": str(call_id),
                                "chat_id": str(chat_id),
                                "from_user_id": str(profile_id),
                            },
                        },
                    )
            except Exception as e:
                print(f"Ошибка отправки call_signal: {e}")
        
        if target_user_id and signal_type in ["webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"]:
            print(f"📞 Отправка {signal_type} пользователю {target_user_id}")
            await self.channel_layer.group_send(
                f"user_{target_user_id}",
                {
                    "type": "call_signal_notification",
                    "signal_type": signal_type,
                    "data": {
                        **data,
                        "call_id": str(call_id),
                        "chat_id": str(chat_id),
                        "from_user_id": str(profile_id),
                    },
                },
            )

    # Получение уведомления из группы
    async def notification(self, event):
        # Преобразуем UUID в строки перед сериализацией
        def convert_uuid_to_str(obj):
            """Рекурсивно преобразует UUID в строки"""
            if isinstance(obj, uuid.UUID):
                return str(obj)
            elif isinstance(obj, dict):
                return {k: convert_uuid_to_str(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_uuid_to_str(item) for item in obj]
            elif isinstance(obj, tuple):
                return tuple(convert_uuid_to_str(item) for item in obj)
            else:
                return obj
        
        try:
            data = convert_uuid_to_str(event.get('data', {}))
            await self.send(text_data=json.dumps({
                'type': 'notification',
                'data': data
            }))
        except Exception as e:
            print(f"Error sending notification: {e}")
            # Если ошибка при отправке, просто пропускаем
    
    # Обработка call_signal для персонального канала
    async def call_signal_notification(self, event):
        def convert_uuid_to_str(obj):
            if isinstance(obj, uuid.UUID):
                return str(obj)
            elif isinstance(obj, dict):
                return {k: convert_uuid_to_str(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_uuid_to_str(item) for item in obj]
            else:
                return obj
        
        try:
            data = convert_uuid_to_str(event.get('data', {}))
            await self.send(text_data=json.dumps({
                'type': 'call_signal',
                'signal_type': event.get('signal_type'),
                'data': data
            }))
            print(f"📞 [UserConsumer] Отправлен call_signal: {event.get('signal_type')}")
        except Exception as e:
            print(f"Error sending call signal to user: {e}")

    @database_sync_to_async
    def check_user_authenticated(self, user):
        """Проверка аутентификации пользователя"""
        return user.is_authenticated
    
    @database_sync_to_async
    def get_user_profile(self, user):
        """Получение профиля пользователя"""
        try:
            return user.profile
        except Profile.DoesNotExist:
            return None
    
    @database_sync_to_async
    def get_profile_id_string(self, profile):
        """Получение ID профиля в виде строки"""
        return str(profile.id)
    
    @database_sync_to_async
    def set_profile_call_status(self, profile_id, status):
        """Обновление статуса звонка пользователя"""
        try:
            profile = Profile.objects.get(id=profile_id)
            profile.call_status = status
            profile.save()
            print(f"✅ Статус звонка обновлен: {profile.username} -> {status}")
        except Profile.DoesNotExist:
            print(f"❌ Профиль не найден для обновления статуса: {profile_id}")
    
    @database_sync_to_async
    def get_user_profile_id(self, user):
        try:
            return str(user.profile.id)
        except Profile.DoesNotExist:
            return None
    
    @database_sync_to_async
    def create_or_get_call_session(self, chat_id, initiator_id, target_user_id, call_id=None, call_type="audio"):
        try:
            chat = Chat.objects.get(id=chat_id)
            initiator = Profile.objects.get(id=initiator_id)
        except (Chat.DoesNotExist, Profile.DoesNotExist):
            return None

        if call_type not in {"audio", "video"}:
            call_type = "audio"

        if target_user_id:
            try:
                target = Profile.objects.get(id=target_user_id)
            except Profile.DoesNotExist:
                return None
        else:
            target = ChatParticipant.objects.filter(chat=chat).exclude(user=initiator).values_list("user", flat=True).first()
            if not target:
                return None
            target = Profile.objects.get(id=target)

        initiator_in_chat = ChatParticipant.objects.filter(chat=chat, user=initiator).exists()
        target_in_chat = ChatParticipant.objects.filter(chat=chat, user=target).exists()
        if not initiator_in_chat or not target_in_chat:
            return None

        if call_id:
            try:
                call_session = CallSession.objects.get(id=call_id, chat=chat)
            except CallSession.DoesNotExist:
                try:
                    parsed_call_id = uuid.UUID(str(call_id))
                except (ValueError, TypeError):
                    return None

                call_session = CallSession.objects.create(
                    id=parsed_call_id,
                    chat=chat,
                    initiator=initiator,
                    call_type=call_type,
                    status="ringing",
                )
                CallParticipant.objects.get_or_create(call=call_session, user=initiator)
                CallParticipant.objects.get_or_create(call=call_session, user=target)
        else:
            call_session = CallSession.objects.create(
                chat=chat,
                initiator=initiator,
                call_type=call_type,
                status="ringing",
            )
            CallParticipant.objects.get_or_create(call=call_session, user=initiator)
            CallParticipant.objects.get_or_create(call=call_session, user=target)

        return {
            "call_id": str(call_session.id),
            "chat_id": str(chat.id),
            "to_user_id": str(target.id),
            "from_user_id": str(initiator.id),
        }
    
    @database_sync_to_async
    def update_call_status(self, call_id, status, user_id, close_call=False, mark_joined=False, mark_left=False):
        try:
            call_session = CallSession.objects.get(id=call_id)
        except CallSession.DoesNotExist:
            return

        if mark_joined:
            participant, _ = CallParticipant.objects.get_or_create(call=call_session, user_id=user_id)
            if participant.joined_at is None:
                participant.joined_at = timezone.now()
                participant.save(update_fields=["joined_at"])

        if mark_left:
            participant = CallParticipant.objects.filter(call=call_session, user_id=user_id).first()
            if participant and participant.left_at is None:
                participant.left_at = timezone.now()
                participant.save(update_fields=["left_at"])

        if status:
            call_session.status = status
        if close_call:
            call_session.ended_at = timezone.now()
            call_session.ended_by_id = user_id
        if status == "active" and call_session.started_at is None:
            call_session.started_at = timezone.now()
        call_session.save(update_fields=["status", "ended_at", "ended_by", "started_at"])
    
    @database_sync_to_async
    def is_call_participant(self, call_id, profile_id, chat_id):
        try:
            call_session = CallSession.objects.get(id=call_id, chat_id=chat_id)
            return str(call_session.initiator_id) == str(profile_id) or \
                   CallParticipant.objects.filter(call=call_session, user_id=profile_id).exists()
        except CallSession.DoesNotExist:
            return False