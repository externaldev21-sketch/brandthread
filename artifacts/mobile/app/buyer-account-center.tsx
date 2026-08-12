import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';

const rows = [
  ['Personal details','user','Name, contact info, birthday'],
  ['Password and security','shield','Password, two-factor authentication and login alerts'],
  ['Login methods','link','Apple, Google and email','/login-methods'],
  ['Biometric unlock','unlock','Face ID, Touch ID or device biometrics','/biometric-unlock'],
  ['Where you’re logged in','smartphone','Review active sessions'],
  ['Your information and permissions','database','Download, transfer and search history'],
  ['Ad and recommendation preferences','sliders','Control personalization'],
  ['Account ownership and control','settings','Deactivation, memorialization and deletion'],
] as const;

export default function BuyerAccountCenter(){
 const router=useRouter(); const insets=useSafeAreaInsets(); const {section}=useLocalSearchParams<{section?:string}>();
 return <View style={[styles.page,{paddingTop:insets.top}]}><View style={styles.header}><TouchableOpacity style={styles.back} onPress={()=>router.back()}><Feather name="arrow-left" size={21} color={FG}/></TouchableOpacity><Text style={styles.title}>Accounts Center</Text><View style={styles.back}/></View><ScrollView contentContainerStyle={{padding:SP.md,paddingBottom:insets.bottom+40}}><View style={styles.hero}><View style={styles.logo}><Text style={styles.logoText}>B</Text></View><View style={{flex:1}}><Text style={styles.heroTitle}>Manage your Brandthread account</Text><Text style={styles.heroSub}>Security, personal details, permissions and account ownership live here.</Text></View></View><View style={styles.card}>{rows.map(([label,icon,sub,route],i)=><TouchableOpacity key={label} style={[styles.row,i<rows.length-1&&styles.divider]} onPress={()=> route ? router.push(route as never) : Alert.alert(label,label==='Account ownership and control' || section==='ownership' ? 'Deactivation and deletion will require identity confirmation before being sent to the backend.' : sub)}><Feather name={icon as any} size={19} color={FG}/><View style={{flex:1}}><Text style={styles.label}>{label}</Text><Text style={styles.sub}>{sub}</Text></View><Feather name="chevron-right" size={18} color={SUBTLE}/></TouchableOpacity>)}</View></ScrollView></View>
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:BG},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:SP.md,borderBottomWidth:1,borderBottomColor:BORDER},back:{width:40,height:40,alignItems:'center',justifyContent:'center'},title:{color:FG,fontFamily:FONT.bold,fontSize:FS.md},hero:{flexDirection:'row',gap:14,alignItems:'center',backgroundColor:CARD,borderWidth:1,borderColor:BORDER,borderRadius:RADIUS.lg,padding:16,marginBottom:16},logo:{width:46,height:46,borderRadius:15,backgroundColor:PURPLE,alignItems:'center',justifyContent:'center'},logoText:{color:'#fff',fontFamily:FONT.extrabold,fontSize:24},heroTitle:{color:FG,fontFamily:FONT.bold,fontSize:15},heroSub:{color:MUTED,fontFamily:FONT.regular,fontSize:11.5,lineHeight:16,marginTop:3},card:{backgroundColor:CARD,borderWidth:1,borderColor:BORDER,borderRadius:RADIUS.lg,overflow:'hidden'},row:{minHeight:64,paddingHorizontal:14,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:12},divider:{borderBottomWidth:1,borderBottomColor:BORDER},label:{color:FG,fontFamily:FONT.medium,fontSize:14},sub:{color:MUTED,fontFamily:FONT.regular,fontSize:11.5,lineHeight:16,marginTop:2}})
