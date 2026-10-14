plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "cl.lumastay.huesped"
    compileSdk = 37

    defaultConfig {
        applicationId = "cl.lumastay.huesped"
        minSdk = 26
        targetSdk = 37
        versionCode = 12
        versionName = "2.1.3"

        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"lumastay-bab6a\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"AIzaSyADKsieNglFr6XRdWOOCJUwQURz5uc8gKI\"")
        buildConfigField("String", "PUBLIC_WEB_URL", "\"https://restblu.web.app/\"")
        buildConfigField("String", "PAYMENTS_API", "\"https://restblu-pagos.restblu.workers.dev\"")
        // Cliente web de Google (Firebase): Google lo usa como audiencia del token.
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"196857425347-n2k7u50vqtv5nnf8ehj3c1tg8emicdmi.apps.googleusercontent.com\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // Acceso con Google (Credential Manager).
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    // org.json real para las pruebas JVM (el de android.jar es sólo un stub).
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
