import { useEffect, useState } from "react";
import { TextInput } from "@mantine/core";

const AmountInput = ({
  value, // Expected: string (e.g., "1.05000000") or ""
  onChange, // Callback with clean string
  placeholder = "Amount",
  decimalScale = 8, // Token decimals, e.g., 18 for ETH
  style,
  ...props
}) => {
  const [inputValue, setInputValue] = useState("");

  // Sync when parent passes a new value (e.g., reset, load)
  useEffect(() => {
    if (value === "" || value == null) {
      setInputValue("");
    } else if (typeof value === "string") {
      setInputValue(value);
    }
  }, [value]);

  const validateAndSet = (str) => {
    // Allow: empty, ".", digits, one decimal point, leading decimal
    const validPattern = /^(\d+\.?\d*|\.\d*)$/;

    if (str === "" || str === "." || validPattern.test(str)) {
      setInputValue(str);
      onChange(str); // Always pass raw string while typing
    }
    // Invalid → ignore keystroke
  };

  const handleBlur = () => {
    if (inputValue === "" || inputValue === ".") {
      onChange("");
      setInputValue("");
      return;
    }

    let cleaned = inputValue.trim();

    // Ensure decimal point exists
    if (!cleaned.includes(".")) {
      cleaned += ".";
    }

    let [integerPart, decimalPart = ""] = cleaned.split(".");

    // Clean integer part: remove leading zeros (but keep "0")
    integerPart = integerPart.replace(/^0+/, "") || "0";

    // Truncate to decimalScale
    decimalPart = decimalPart.substring(0, decimalScale);
    let fixedStr;
    if (parseInt(decimalPart) === 0 || decimalPart === "") {
      fixedStr = `${integerPart}`;
    } else {
      fixedStr = `${integerPart}.${decimalPart}`;
    }

    onChange(fixedStr);
    setInputValue(fixedStr);
  };

  return (
    <TextInput
      value={inputValue}
      onChange={(e) => validateAndSet(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
      style={{
        ...style,
        textAlign: "right",
        fontFeatureSettings: "'tnum' 1", // Tabular numerals for alignment
      }}
      {...props}
    />
  );
};

export default AmountInput;
