import { useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { verificar_credenciales } from './src/services/login';

export default function App() {
  const [identificador, set_identificador] = useState('');
  const [password, set_password] = useState('');
  const [visible, set_visible] = useState(false);
  const [focused, set_focused] = useState(null);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState('');
  const [empleado, set_empleado] = useState(null);
  const password_ref = useRef(null);
  const pending = useRef(false);

  async function iniciar_sesion() {
    if (pending.current) return;
    if (!identificador.trim() || !password) {
      set_error('Enter your employee ID or email and password.');
      return;
    }
    Keyboard.dismiss();
    pending.current = true;
    set_loading(true);
    set_error('');
    try {
      const result = await verificar_credenciales(identificador, password);
      set_password('');
      set_visible(false);
      set_empleado(result);
    } catch (failure) {
      set_error(failure.message || 'Unable to sign in. Please try again.');
    } finally {
      pending.current = false;
      set_loading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}><Text style={styles.logoText}>L</Text></View>
          <View><Text style={styles.brand}>lector<Text style={styles.blue}>.</Text></Text><Text style={styles.caption}>ATTENDANCE & ACCESS</Text></View>
        </View>
        <View style={styles.main}>
          <View style={styles.intro}>
            <Text style={styles.tag}>●  YOUR WORKDAY, CONNECTED</Text>
            <Text style={styles.headline}>A simple start.{'\n'}<Text style={styles.blue}>A better day.</Text></Text>
            <Text style={styles.description}>Your attendance and workplace access,{'\n'}together in one place.</Text>
          </View>
          <View style={styles.card}>
            {empleado ? <>
              <View style={styles.success}><Text style={styles.check}>✓</Text></View>
              <Text style={styles.eyebrow}>CREDENTIALS VERIFIED</Text>
              <Text accessibilityRole="header" style={styles.title}>Welcome, {empleado.nombre}.</Text>
              <Text style={styles.subtitle}>Your details have been confirmed.</Text>
              <View style={styles.profile}>
                <Text style={styles.profileName}>{empleado.nombre} {empleado.apellido}</Text>
                <Text style={styles.detail}>Employee ID · {empleado.id}</Text>
                {empleado.correo ? <Text style={styles.detail}>{empleado.correo}</Text> : null}
                <Text style={styles.badge}>{empleado.rol === 'administrativo' ? 'Administrative' : 'Employee'}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => { set_empleado(null); set_error(''); }} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.buttonText}>Back to sign in</Text></Pressable>
            </> : <>
              <Text style={styles.eyebrow}>EMPLOYEE PORTAL</Text>
              <Text accessibilityRole="header" style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to start your day.</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Employee ID or email</Text>
                <View style={[styles.inputWrap, focused === 'id' && styles.focused]}>
                  <TextInput accessibilityLabel="Employee ID or email" style={styles.input}
                    placeholder="ID or name@company.com" placeholderTextColor="#8a97ac"
                    value={identificador} onChangeText={(value) => { set_identificador(value); set_error(''); }}
                    autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username"
                    maxLength={150} editable={!loading} returnKeyType="next"
                    onSubmitEditing={() => password_ref.current?.focus()}
                    onFocus={() => set_focused('id')} onBlur={() => set_focused(null)} />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <View style={[styles.inputWrap, focused === 'password' && styles.focused]}>
                  <TextInput ref={password_ref} accessibilityLabel="Password" style={styles.input}
                    placeholder="Enter your password" placeholderTextColor="#8a97ac"
                    value={password} onChangeText={(value) => { set_password(value); set_error(''); }}
                    secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false}
                    autoComplete="current-password" textContentType="password" maxLength={128}
                    editable={!loading} returnKeyType="go" onSubmitEditing={iniciar_sesion}
                    onFocus={() => set_focused('password')} onBlur={() => set_focused(null)} />
                  <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} disabled={loading} onPress={() => set_visible(!visible)} style={styles.show}><Text style={styles.showText}>{visible ? 'Hide' : 'Show'}</Text></Pressable>
                </View>
              </View>
              {error ? <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }} disabled={loading}
                onPress={iniciar_sesion} style={({ pressed }) => [styles.button, pressed && styles.pressed, loading && styles.disabled]}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : null}
                <Text style={styles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
                {!loading ? <Text style={styles.arrow}>→</Text> : null}
              </Pressable>
              <Text style={styles.help}>Need access? Contact your administrator.</Text>
            </>}
          </View>
        </View>
        <Text style={styles.footer}>LECTOR  /  ATTENDANCE MADE SIMPLE</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f8ff' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 28, alignItems: 'center' },
  header: { width: '100%', maxWidth: 1040, flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 29, fontWeight: '800', color: '#fff' },
  brand: { color: '#142745', fontWeight: '800', fontSize: 27, letterSpacing: -1 },
  caption: { fontSize: 9, color: '#667791', letterSpacing: 1.7, fontWeight: '600' },
  main: { flex: 1, justifyContent: 'center', width: '100%', maxWidth: 1040, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 48, paddingVertical: 44 },
  intro: { flexGrow: 1, flexShrink: 1, flexBasis: 300, maxWidth: 480 },
  tag: { color: '#3563b5', fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginBottom: 24 },
  headline: { fontSize: 42, lineHeight: 50, fontWeight: '800', letterSpacing: -1.7, color: '#142745' },
  blue: { color: '#2563eb' },
  description: { fontSize: 15, lineHeight: 25, color: '#64748b', marginTop: 20 },
  card: { width: '100%', flexBasis: 420, flexGrow: 1, flexShrink: 1, maxWidth: 460, padding: 28, backgroundColor: '#fff', borderRadius: 26, borderWidth: 1, borderColor: '#e5ecf8', boxShadow: '0 16px 60px rgba(34, 71, 136, 0.07)' },
  eyebrow: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 29, fontWeight: '700', letterSpacing: -0.8, color: '#142745' },
  subtitle: { fontSize: 14, color: '#718096', marginTop: 10, marginBottom: 30, lineHeight: 22 },
  field: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#33435c', marginBottom: 9 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#dfe6f0', backgroundColor: '#fbfcff', minHeight: 54 },
  focused: { borderColor: '#2563eb', backgroundColor: '#fff' },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 15, paddingVertical: 16, fontSize: 14, color: '#142745', outlineStyle: 'none' },
  show: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center' },
  showText: { fontSize: 12, fontWeight: '600', color: '#2563eb' },
  button: { backgroundColor: '#2563eb', borderRadius: 12, minHeight: 54, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 15, marginTop: 8 },
  pressed: { backgroundColor: '#1d4ed8' },
  disabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  arrow: { color: '#fff', fontSize: 21 },
  help: { marginTop: 26, borderTopWidth: 1, borderTopColor: '#edf1f7', paddingTop: 22, color: '#7b879b', fontSize: 12, textAlign: 'center', lineHeight: 19 },
  errorBox: { backgroundColor: '#fff2f2', borderRadius: 10, padding: 13, marginBottom: 12 },
  errorText: { color: '#b42333', fontSize: 13, lineHeight: 20 },
  footer: { color: '#8795ad', fontSize: 9, letterSpacing: 1.7, textAlign: 'center' },
  success: { width: 52, height: 52, backgroundColor: '#edf4ff', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  check: { fontSize: 27, color: '#2563eb' },
  profile: { backgroundColor: '#f5f8ff', padding: 20, borderRadius: 14, marginBottom: 20, gap: 8 },
  profileName: { fontSize: 17, color: '#142745', fontWeight: '600' },
  detail: { fontSize: 13, color: '#64748b' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#e5edff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginTop: 5, color: '#2458c0', fontWeight: '600', fontSize: 11 },
});
