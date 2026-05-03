export function findFirstJsonArray(text: string): string | null {
  const startIndex = text.indexOf("[")

  if (startIndex === -1) {
    return null
  }

  let depth = 0
  let isInString = false
  let shouldEscapeNext = false

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index]

    if (shouldEscapeNext) {
      shouldEscapeNext = false
      continue
    }

    if (character === "\\") {
      shouldEscapeNext = true
      continue
    }

    if (character === '"') {
      isInString = !isInString
      continue
    }

    if (isInString) {
      continue
    }

    if (character === "[") {
      depth += 1
    } else if (character === "]") {
      depth -= 1

      if (depth === 0) {
        return text.substring(startIndex, index + 1)
      }
    }
  }

  return null
}

export function extractCompleteObjectsFromJsonArray(jsonText: string): string {
  const startIndex = jsonText.indexOf("[")

  if (startIndex === -1) {
    return jsonText
  }

  const completeObjects: string[] = []
  let arrayDepth = 0
  let objectDepth = 0
  let isInString = false
  let shouldEscapeNext = false
  let currentObjectStart = -1

  for (let index = startIndex + 1; index < jsonText.length; index += 1) {
    const character = jsonText[index]

    if (shouldEscapeNext) {
      shouldEscapeNext = false
      continue
    }

    if (character === "\\") {
      shouldEscapeNext = true
      continue
    }

    if (character === '"') {
      isInString = !isInString
      continue
    }

    if (isInString) {
      continue
    }

    if (character === "{") {
      if (objectDepth === 0) {
        currentObjectStart = index
      }

      objectDepth += 1
    } else if (character === "}") {
      objectDepth -= 1

      if (objectDepth === 0 && currentObjectStart !== -1) {
        completeObjects.push(jsonText.substring(currentObjectStart, index + 1))
        currentObjectStart = -1
      }
    } else if (character === "[") {
      arrayDepth += 1
    } else if (character === "]") {
      if (arrayDepth === 0) {
        break
      }

      arrayDepth -= 1
    }
  }

  return `[${completeObjects.join(",")}]`
}
