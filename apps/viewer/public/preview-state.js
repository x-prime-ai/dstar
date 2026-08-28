// Only the trusted bridge can establish that this exact preview rendered.
export class PreviewState {
  reset(frame = null) {
    this.frame = frame;
    this.status = "loading";
  }
  fail() {
    this.status = "failed";
  }
  receive(event, source) {
    if (
      !this.frame ||
      this.status !== "loading" ||
      event.source !== source ||
      event.origin !== "null" ||
      event.data?.kind !== "dstar-preview" ||
      event.data.capability !== this.frame.capability ||
      event.data.revision !== this.frame.revision ||
      !["ready", "failed"].includes(event.data.status)
    )
      return false;
    this.status = event.data.status;
    return true;
  }
  canAccept(selected, head, showingBase) {
    return (
      this.status === "ready" &&
      !showingBase &&
      selected?.status === "pending" &&
      selected.parent === head &&
      selected.revision === this.frame?.revision
    );
  }
}
