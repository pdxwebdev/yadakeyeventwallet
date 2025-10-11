// Styles (unchanged)
export const styles = (theme) => ({
  card: {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[7]
        : theme.colors.gray[0],
    color: theme.colorScheme === "dark" ? theme.colors.dark[0] : theme.black,
  },
  nestedCard: {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[6]
        : theme.colors.gray[1],
    color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
  },
  title: {
    color: theme.colorScheme === "dark" ? theme.white : theme.black,
  },
  table: {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[6]
        : theme.colors.gray[1],
    color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
  },
  tableHeader: {
    color: theme.colorScheme === "dark" ? theme.white : theme.black,
  },
  input: {
    backgroundColor:
      theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.white,
    color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
    borderColor:
      theme.colorScheme === "dark"
        ? theme.colors.dark[4]
        : theme.colors.gray[4],
  },
  inputLabel: {
    color: theme.colorScheme === "dark" ? theme.white : theme.black,
  },
  modal: {
    backgroundColor:
      theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white,
  },
  qrModal: {
    backgroundColor:
      theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
  },
  webcam: {
    borderRadius: "8px",
    border: `1px solid ${
      theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[4]
    }`,
  },
  button: {
    "&:hover": {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.teal[7]
          : theme.colors.teal[5],
    },
  },
});
