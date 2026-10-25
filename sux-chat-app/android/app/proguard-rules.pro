# Правила R8 для релизной сборки (minifyEnabled в app/build.gradle).
#
# Плагины Capacitor (наследники Plugin, методы @PluginMethod) сохраняет
# consumer-правило самого Capacitor, Firebase и androidx приносят свои.
# Здесь — то, что R8 не видит: вызовы по имени и рефлексия.

# Номера строк в стектрейсах краша; имена файлов скрыты.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Наш код: плагины, сервисы пушей и звонков, приёмники. Его мало, а часть
# вызывается по имени из манифеста и JS — проще не обфусцировать вовсе.
-keep class com.huyax.app.** { *; }

# Методы, которые страница зовёт через мост WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Обновление по воздуху (@capgo/capacitor-updater): его proguard-rules.pro
# подключён только к сборке самой библиотеки, не как consumer — переносим.
-keepattributes *Annotation*, Signature
-keep class ee.forgr.capacitor_updater.** { *; }
-keep class com.getcapacitor.Bridge {
    com.getcapacitor.MessageHandler msgHandler;
}
-keep class com.getcapacitor.MessageHandler { *; }
-keep class com.getcapacitor.PluginCall {
    <init>(com.getcapacitor.MessageHandler, java.lang.String, java.lang.String, java.lang.String, com.getcapacitor.JSObject);
}
-keep class * implements com.getcapacitor.PluginHandle {
    public void invoke(java.lang.String, com.getcapacitor.PluginCall);
}
# Он же достаёт androidx.webkit через Class.forName.
-keep class androidx.webkit.WebViewFeature { *; }
-keep class androidx.webkit.WebViewCompat { *; }

# Геолокация: библиотека Ionic разбирает настройки через Gson.
-keep class io.ionic.libs.** { *; }
