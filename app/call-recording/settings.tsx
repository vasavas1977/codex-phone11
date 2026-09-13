import { isMissingCloudProcedure } from "@/hooks/use-cloud-recordings";
import { useColors } from "@/hooks/use-colors";
import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useDirectory } from "@/hooks/use-directory";
import { useAuth } from "@/hooks/use-auth";
import * as Auth from "@/lib/_core/auth";
import { createTRPCClient } from "@/lib/trpc";
import type { CloudRecordingPolicy } from "@/shared/cloud-recordings";
export default function RecordingSettings() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const directory = useDirectory();
  const [tenant, setTenant] = useState<number>();
  const [policy, setPolicy] = useState<CloudRecordingPolicy>();
  const [policyIdentity, setPolicyIdentity] = useState<typeof user>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTenant(undefined);
    setPolicy(undefined);
    setBusy(false);
    return Auth.addAuthChangeListener(() => {
      setTenant(undefined);
      setPolicy(undefined);
      setMessage("");
      setBusy(false);
    });
  }, [user]);
  useEffect(() => {
    setPolicy(undefined);
    setMessage("");
    let active = true;
    const identity = Auth.getAuthSnapshot().user;
    if (tenant && identity)
      void createTRPCClient()
        .cloudRecordings.getPolicy.query({ tenantId: tenant })
        .then((value) => {
          if (active && Auth.getAuthSnapshot().user === identity) {
            setPolicyIdentity(identity);
            setPolicy(value);
          }
        })
        .catch((error) => {
          if (active && Auth.getAuthSnapshot().user === identity)
            setMessage(
              isMissingCloudProcedure(error, "getPolicy")
                ? "Cloud recording is not available on this server yet."
                : "Could not load recording settings. Please try again.",
            );
        });
    return () => {
      active = false;
    };
  }, [tenant, user]);
  const save = async (next: CloudRecordingPolicy) => {
    const identity = Auth.getAuthSnapshot().user;
    if (!identity || !tenant || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const updated =
        await createTRPCClient().cloudRecordings.updatePolicy.mutate({
          tenantId: tenant,
          mode: next.mode,
          aiEnabled: next.aiEnabled,
          retentionDays: next.retentionDays,
        });
      if (Auth.getAuthSnapshot().user === identity) {
        setPolicy(updated);
        setMessage("Settings saved.");
      }
    } catch (error) {
      if (Auth.getAuthSnapshot().user === identity)
        setMessage(
          isMissingCloudProcedure(error, "updatePolicy")
            ? "Cloud recording is not available on this server yet."
            : "Could not save recording settings.",
        );
    } finally {
      if (Auth.getAuthSnapshot().user === identity) setBusy(false);
    }
  };
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text style={{ fontSize: 24, color: colors.foreground }}>
          Recording settings
        </Text>
        <Text style={{ color: colors.foreground }}>Choose your workspace</Text>
        {directory.workspaces.map((workspace) => (
          <TouchableOpacity
            style={{ minHeight: 48, justifyContent: "center" }}
            key={workspace.id}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setPolicy(undefined);
              setTenant(workspace.id);
            }}
          >
            <Text style={{ color: colors.foreground }}>
              {workspace.name}
              {tenant === workspace.id ? " ✓" : ""}
            </Text>
          </TouchableOpacity>
        ))}
        {directory.error && (
          <Text style={{ color: colors.foreground }}>{directory.error}</Text>
        )}
        {policy && policyIdentity === user && (
          <>
            {!policy.captureAvailable && (
              <Text style={{ color: colors.foreground }}>
                Cloud recording capture is not available yet. Enabling a policy
                does not record calls until capture is available.
              </Text>
            )}
            <Text style={{ color: colors.foreground }}>
              Recording: {policy.mode}
            </Text>
            {!policy.analysisAvailable && (
              <Text style={{ color: colors.muted }}>
                AI summaries need to be set up for this workspace.
              </Text>
            )}
            {!policy.canEdit && (
              <Text style={{ color: colors.foreground }}>
                Only workspace administrators can change these settings.
              </Text>
            )}
            {policy.canEdit && (
              <>
                {(["off", "manual", "automatic"] as const).map((mode) => (
                  <TouchableOpacity
                    style={{ minHeight: 48, justifyContent: "center" }}
                    key={mode}
                    accessibilityRole="button"
                    disabled={
                      busy || (!policy.captureAvailable && mode !== "off")
                    }
                    onPress={() => void save({ ...policy, mode })}
                  >
                    <Text style={{ color: colors.foreground }}>
                      {mode === "off"
                        ? "Off"
                        : mode === "manual"
                          ? "Manual recording"
                          : "Automatic recording"}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={{ minHeight: 48, justifyContent: "center" }}
                  accessibilityRole="button"
                  disabled={
                    busy || (!policy.aiEnabled && !policy.analysisAvailable)
                  }
                  onPress={() =>
                    void save({ ...policy, aiEnabled: !policy.aiEnabled })
                  }
                >
                  <Text style={{ color: colors.foreground }}>
                    AI summaries: {policy.aiEnabled ? "On" : "Off"}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: colors.foreground }}>
                  Keep recordings for {policy.retentionDays} days
                </Text>
                {[7, 30, 90].map((days) => (
                  <TouchableOpacity
                    style={{ minHeight: 48, justifyContent: "center" }}
                    key={days}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() =>
                      void save({ ...policy, retentionDays: days })
                    }
                  >
                    <Text style={{ color: colors.foreground }}>
                      {days} days
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}
        {!!message && (
          <Text style={{ color: colors.foreground }}>{message}</Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
