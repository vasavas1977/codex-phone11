import { useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { ContactDetails } from "@/components/contact-details";

export default function ContactDetailScreen() {
  const params = useLocalSearchParams<{ id: string; tenantId: string }>();
  return (
    <ScreenContainer>
      <ContactDetails id={params.id} tenantId={params.tenantId} />
    </ScreenContainer>
  );
}
